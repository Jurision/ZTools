using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

/**
 * Captures only plain physical middle-button clicks on a dedicated message thread.
 * All other mouse events are unconditionally forwarded. The callback never sends keys.
 */
sealed class MiddleButtonInput : IDisposable {
    public const int Message=0x8001;
    public const int RefreshedMessage=0x8002,RefreshFailedMessage=0x8003;
    const int Down=0x207,Up=0x208;
    delegate IntPtr HookProc(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,HookProc callback,IntPtr module,uint tid);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] events,int size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public int x,y;public uint mouseData,flags,time;public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
    [StructLayout(LayoutKind.Explicit)] struct UNION {
        [FieldOffset(0)] public MouseData mouse;
    }

    internal struct Decision { public bool Swallow,Notify,NativeClick,NativeRelease; }
    /**
     * Pure middle-button routing: never consumes left/right/scroll/side-button events.
     */
    internal sealed class Filter {
        bool down,native;long pressedAt;IntPtr origin;
        public bool Pressed {get{return down;}}
        /**
         * Determines whether a held physical middle button has reached the native threshold.
         * @param now Monotonic time in milliseconds.
         * @param busy Whether modifiers or other conflicting buttons are held.
         * @param foreground Observed foreground window handle.
         * @returns Whether the condition is satisfied.
         */
        public bool NativeDue(long now,bool busy,IntPtr foreground){
            if(!down||native||now-pressedAt<350||busy||foreground!=origin)return false;
            native=true;return true;
        }
        /**
         * Routes only plain physical middle-button events, forwarding all unrelated mouse input.
         * @param code Native hook status code.
         * @param message Native message or message identifier.
         * @param injected Whether Windows marked this event as injected.
         * @param busy Whether modifiers or other conflicting buttons are held.
         * @param foreground Observed foreground window handle.
         * @param now Monotonic time in milliseconds.
         * @returns Routing decision for the current event.
         */
        public Decision Route(int code,int message,bool injected,bool busy,IntPtr foreground,long now){
            if(code<0||(message!=Down&&message!=Up)||injected)return new Decision();
            if(message==Down){
                if(down)return new Decision{Swallow=true};
                if(busy||foreground==IntPtr.Zero)return new Decision();
                down=true;native=false;pressedAt=now;origin=foreground;
                return new Decision{Swallow=true};
            }
            if(!down)return new Decision();
            down=false;
            if(native)return new Decision{Swallow=true,NativeRelease=true};
            bool valid=!busy&&foreground==origin;
            return new Decision{Swallow=true,Notify=valid&&now-pressedAt<350,NativeClick=valid&&now-pressedAt>=350};
        }
    }

    /**
     * Reclaims middle-click precedence after WeType installs its per-recording mouse hook.
     * Two bounded attempts cover immediate and delayed installation without a polling hook race.
     */
    internal sealed class RearmSchedule {
        bool visible;int remaining;long next;
        /**
         * Updates visibility timing without registering hooks or generating input.
         * @param now Monotonic time in milliseconds.
         * @param shown Whether the identified voice panel is visible.
         * @returns Whether the condition is satisfied.
         */
        public bool Observe(long now,bool shown){
            if(!shown){visible=false;remaining=0;return false;}
            if(!visible){visible=true;remaining=2;next=now;}
            if(remaining==0||now<next)return false;
            remaining--;next=now+350;return true;
        }
    }

    readonly IntPtr receiver;
    readonly Filter filter=new Filter();
    readonly RearmSchedule rearm=new RearmSchedule();
    readonly Stopwatch watch=Stopwatch.StartNew();
    readonly ManualResetEvent ready=new ManualResetEvent(false);
    readonly Thread thread;
    HookProc callback;IntPtr hook,queueWindow;uint threadId;Exception error;bool deferredRearm,nativeDown;

    /**
     * Sends native middle-button input outside the mouse callback and tracks owned presses.
     * @param flags Native middle-button input flags.
     * @returns No value.
     */
    void NativeMouse(uint flags){
        var input=new INPUT{type=0,data=new UNION{mouse=new MouseData{flags=flags}}};
        if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))==1){if(flags==0x20)nativeDown=true;else nativeDown=false;}
    }
    /**
     * Starts due native holds and retries a pending release after physical release.
     * @returns No value.
     */
    void NativeTick(){
        if(filter.NativeDue(watch.ElapsedMilliseconds,Busy(),GetForegroundWindow()))NativeMouse(0x20);
        // Retry a failed release; never leave our synthetic middle press held after physical release.
        if(nativeDown&&!filter.Pressed)NativeMouse(0x40);
    }
    /**
     * Replays a queued native middle click or release on the hook message thread.
     * @param kind Queued native click or release action.
     * @returns No value.
     */
    void Replay(int kind){
        if(kind==1){NativeMouse(0x20);if(nativeDown)NativeMouse(0x40);}
        if(kind==2&&nativeDown)NativeMouse(0x40);
    }

    /**
     * Queues at most two hook refreshes for each newly observed voice session.
     * @param now Monotonic time in milliseconds.
     * @param shown Whether the identified voice panel is visible.
     * @returns No value.
     */
    public void ObserveVoice(long now,bool shown){
        if(rearm.Observe(now,shown)&&queueWindow!=IntPtr.Zero)PostMessage(queueWindow,Message,IntPtr.Zero,IntPtr.Zero);
    }

    /**
     * Installs the replacement hook before removing the old one, deferring while held.
     * @returns No value.
     */
    void Refresh(){
        if(filter.Pressed){deferredRearm=true;return;}
        deferredRearm=false;
        var replacement=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
        if(replacement==IntPtr.Zero){PostMessage(receiver,RefreshFailedMessage,new IntPtr(Marshal.GetLastWin32Error()),IntPtr.Zero);return;}
        var previous=hook;hook=replacement;
        if(previous!=IntPtr.Zero)UnhookWindowsHookEx(previous);
        PostMessage(receiver,RefreshedMessage,IntPtr.Zero,IntPtr.Zero);
    }

    /**
     * Starts a dedicated middle-button message thread and checks initialization.
     * @param window Native window handle.
     * @returns No value.
     * @throws Exception when validation or native initialization fails.
     */
    public MiddleButtonInput(IntPtr window){
        receiver=window;thread=new Thread(Run){IsBackground=true,Name="MiddleButtonInput"};
        thread.SetApartmentState(ApartmentState.STA);thread.Start();
        if(!ready.WaitOne(2000)){Dispose();throw new Exception("Middle-button listener initialization timeout");}
        if(error!=null){Dispose();throw new Exception("Middle-button listener unavailable",error);}
    }
    /**
     * Checks whether a virtual key is currently pressed.
     * @param key Virtual key or action key identifier.
     * @returns Whether the condition is satisfied.
     */
    static bool Held(int key){return (GetAsyncKeyState(key)&0x8000)!=0;}
    /**
     * Checks modifiers and primary buttons before capturing a plain middle gesture.
     * @returns Whether the condition is satisfied.
     */
    static bool Busy(){return Held(0x10)||Held(0x11)||Held(0x12)||Held(0x5b)||Held(0x5c)||Held(0x01)||Held(0x02);}
    /**
     * Routes a mouse callback without disk access, process queries, waits or input injection.
     * @param code Native hook status code.
     * @param message Native message or message identifier.
     * @param data Pointer to the native mouse event.
     * @returns Native handle or callback result.
     */
    IntPtr Handle(int code,IntPtr message,IntPtr data){
        // This early exit is the safety boundary for primary buttons, wheel and side buttons.
        int kind=message.ToInt32();
        if(code<0||(kind!=Down&&kind!=Up))return CallNextHookEx(hook,code,message,data);
        try{
            var native=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
            var decision=filter.Route(code,kind,(native.flags&3)!=0,Busy(),GetForegroundWindow(),watch.ElapsedMilliseconds);
            if(decision.Notify)PostMessage(receiver,Message,IntPtr.Zero,IntPtr.Zero);
            if(decision.NativeClick)PostMessage(queueWindow,RefreshedMessage,new IntPtr(1),IntPtr.Zero);
            if(decision.NativeRelease)PostMessage(queueWindow,RefreshedMessage,new IntPtr(2),IntPtr.Zero);
            if(kind==Up&&deferredRearm)PostMessage(queueWindow,Message,IntPtr.Zero,IntPtr.Zero);
            if(decision.Swallow)return new IntPtr(1);
        }catch{
            // Fail open: an unexpected failure must not block normal mouse input.
        }
        return CallNextHookEx(hook,code,message,data);
    }
    /**
     * Owns the hook message loop and releases synthetic presses and hooks when it exits.
     * @returns No value.
     * @throws Exception when validation or native initialization fails.
     */
    void Run(){
        try{
            threadId=GetCurrentThreadId();callback=Handle;
            hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
            if(hook==IntPtr.Zero)throw new Exception("SetWindowsHookEx error "+Marshal.GetLastWin32Error());
            // Establish the thread's queue before signalling readiness.
            using(var context=new ApplicationContext()){
                using(var queue=new NativeWindowQueue(Refresh,Replay))
                using(var timer=new System.Windows.Forms.Timer()) {
                    queueWindow=queue.Handle;timer.Interval=15;timer.Tick+=(s,e)=>NativeTick();timer.Start();ready.Set();Application.Run(context);
                }
            }
        }catch(Exception ex){error=ex;ready.Set();}
        finally{if(nativeDown)NativeMouse(0x40);if(hook!=IntPtr.Zero){UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}}
    }
    sealed class NativeWindowQueue:NativeWindow,IDisposable{
        readonly Action refresh;readonly Action<int> replay;
        /**
         * Creates the message-only window for deferred hook refresh and native replay.
         * @param action Action name or deferred refresh callback.
         * @param replayAction Deferred native mouse replay callback.
         * @returns No value.
         */
        public NativeWindowQueue(Action action,Action<int> replayAction){refresh=action;replay=replayAction;CreateHandle(new CreateParams{Caption="MiddleButtonInputQueue",Parent=new IntPtr(-3)});}
        /**
         * Dispatches internal messages and forwards ordinary window messages to the base handler.
         * @param m Window message to dispatch.
         * @returns No value.
         */
        protected override void WndProc(ref System.Windows.Forms.Message m){if(m.Msg==MiddleButtonInput.Message)refresh();if(m.Msg==MiddleButtonInput.RefreshedMessage)replay(m.WParam.ToInt32());base.WndProc(ref m);}
        /**
         * Releases owned timers, window handles or hook-thread resources.
         * @returns No value.
         */
        public void Dispose(){DestroyHandle();}
    }
    /**
     * Releases owned timers, window handles or hook-thread resources.
     * @returns No value.
     */
    public void Dispose(){if(threadId!=0)PostThreadMessage(threadId,0x12,IntPtr.Zero,IntPtr.Zero);if(Thread.CurrentThread!=thread)thread.Join(500);}

    /**
     * Runs pure regression checks without creating windows, hooks, hotkeys or runtime files.
     * @returns Assertion count or operation status.
     * @throws Exception when validation or native initialization fails.
     */
    public static int Tests(){
        int count=0;Action<bool,string> check=(ok,name)=>{if(!ok)throw new Exception("Middle-button test failed: "+name);count++;};
        var f=new Filter();IntPtr a=new IntPtr(1),b=new IntPtr(2);
        int[] passthrough={0x200,0x201,0x202,0x203,0x204,0x205,0x206,0x20a,0x20b,0x20c,0x20e};
        foreach(int message in passthrough){var d=f.Route(0,message,false,false,a,0);check(!d.Swallow&&!d.Notify,"unrelated message "+message);}
        check(!f.Route(-1,Down,false,false,a,0).Swallow,"negative hook code forwarded");
        check(!f.Route(0,Down,true,false,a,0).Swallow,"injected middle forwarded");
        check(!f.Route(0,Down,false,true,a,0).Swallow,"modified middle forwarded");
        check(!f.Route(0,Up,false,false,a,1).Swallow,"unowned release forwarded");
        check(!f.Route(0,Down,false,false,IntPtr.Zero,2).Swallow,"unknown foreground forwarded");
        var down=f.Route(0,Down,false,false,a,10);check(down.Swallow&&!down.Notify,"down swallowed without keys or notification");
        check(!f.Route(0,Down,false,false,a,20).Notify,"repeat down cannot activate");
        foreach(int message in passthrough){var d=f.Route(0,message,false,false,a,30);check(!d.Swallow&&!d.Notify,"unrelated message while middle held "+message);}
        var up=f.Route(0,Up,false,false,a,50);check(up.Swallow&&up.Notify,"release posts exactly one notification");
        check(!f.Route(0,Up,false,false,a,60).Notify,"repeat release cannot activate");
        f.Route(0,Down,false,false,a,100);check(!f.Route(0,Up,false,false,b,150).Notify,"focus changed during press");
        f.Route(0,Down,false,false,a,200);check(!f.Route(0,Up,false,true,a,220).Notify,"modifier pressed mid gesture");
        f.Route(0,Down,false,false,a,300);var longClick=f.Route(0,Up,false,false,a,2000);check(!longClick.Notify&&longClick.NativeClick,"long release uses native click if timer delayed");
        f.Route(0,Down,false,false,a,2100);check(!f.NativeDue(2449,false,a),"before 350ms no native down");
        check(f.NativeDue(2450,false,a),"at 350ms native down");
        check(!f.NativeDue(2500,false,a),"native down once while holding");
        var release=f.Route(0,Up,false,false,b,2700);check(release.Swallow&&release.NativeRelease&&!release.Notify,"release native hold even after focus changes");
        check(!f.Route(0,Up,false,false,b,2800).NativeRelease,"native up once");
        f.Route(0,Down,false,false,a,3000);check(!f.NativeDue(3400,true,a),"modifier blocks native start");
        check(!f.NativeDue(3400,false,b),"focus change blocks native start");
        check(!f.Route(0,Up,false,false,b,3500).NativeClick,"cancelled long gesture cannot click elsewhere");
        f.Route(0,Down,false,false,a,4000);var boundary=f.Route(0,Up,false,false,a,4350);check(boundary.NativeClick&&!boundary.Notify,"release at threshold is native not voice");
        check(Marshal.SizeOf(typeof(INPUT))==40,"native mouse INPUT size");
        var clock=Stopwatch.StartNew();for(int i=0;i<100000;i++)f.Route(0,0x200,false,false,a,i);
        check(clock.ElapsedMilliseconds<100,"100000 mouse move routing calls under 100ms");
        var schedule=new RearmSchedule();
        check(!schedule.Observe(0,false),"no rearm without voice");
        check(schedule.Observe(100,true),"new voice session reclaims priority");
        check(!schedule.Observe(200,true),"no continuous reinstalls");
        check(!schedule.Observe(449,true),"delayed rearm waits");
        check(schedule.Observe(450,true),"bounded second rearm covers delayed hook");
        check(!schedule.Observe(5000,true),"stable recording no hook race");
        check(!schedule.Observe(5100,false),"closed session resets");
        check(schedule.Observe(5200,true),"next recording rearmed");
        check(!schedule.Observe(5300,false),"early closing cancels pending rearm");
        check(!schedule.Observe(6000,false),"no delayed rearm after close");
        check(schedule.Observe(6100,true),"manual recording receives protection too");
        return count;
    }
}
