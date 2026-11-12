using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Physical middle clicks arrive as internal messages from MiddleButtonInput.
// Ctrl+Shift+F11 remains a legacy entry point; do not bind it to the mouse.
sealed class VoiceSearch {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int max);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    delegate bool WindowCallback(IntPtr window,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEY key; [FieldOffset(0)] public MOUSE mouse; }
    [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }

    // Pure state machine. Each activation can emit one launcher and one voice action.
    internal sealed class Sequence {
        public bool Active { get { return phase!=0; } }
        int phase; long started,stable=-1; IntPtr origin,target;
        /**
         * Starts a pending sequence or routes an observed live voice session to termination.
         * @param now Monotonic time in milliseconds.
         * @param foreground Observed foreground window handle.
         * @returns No value.
         */
        public void Start(long now,IntPtr foreground) { if(Active)return; phase=1;started=now;stable=-1;origin=foreground;target=IntPtr.Zero; }
        /**
         * Cancels pending actions without generating any input.
         * @returns No value.
         */
        public void Cancel(){phase=0;}
        /**
         * Advances the pure state machine and returns at most one action for this tick.
         * @param now Monotonic time in milliseconds.
         * @param keysHeld Whether a conflicting key remains pressed.
         * @param foreground Observed foreground window handle.
         * @param isSearch Whether the foreground is the ZTools search box.
         * @param cancel Whether external input cancels the pending action.
         * @returns Action name or test summary; null when no action is due.
         */
        public string Step(long now,bool keysHeld,IntPtr foreground,bool isSearch,bool cancel) {
            if(!Active)return null;
            if(cancel||now-started>=3000||foreground==IntPtr.Zero){phase=0;return "cancel";}
            if(phase==1) {
                if(foreground!=origin){phase=0;return "cancel";}
                if(keysHeld)return null;
                phase=2;
                // Ctrl+Space toggles the launcher; do not hide it when already focused.
                if(!isSearch)return "launch";
            }
            if(!isSearch) {
                if(target!=IntPtr.Zero||foreground!=origin){phase=0;return "cancel";}
                return null;
            }
            if(target!=IntPtr.Zero&&target!=foreground){phase=0;return "cancel";}
            target=foreground;
            if(keysHeld){stable=-1;return null;}
            if(stable<0)stable=now;
            if(now-stable<300)return null;
            phase=0;return "voice";
        }
    }

    readonly Sequence sequence=new Sequence();
    readonly StopGesture stop=new StopGesture();
    readonly Action<string> log;
    long nextObservation;
    long lastVoiceSent=-10000;
    IntPtr stopOrigin;
    public bool Active {get{return sequence.Active||stop.Pending;}}
    public bool PanelVisible {get;private set;}
    /**
     * Stores the diagnostic callback for voice sequencing.
     * @param logger Metadata-only diagnostic callback.
     * @returns No value.
     */
    public VoiceSearch(Action<string> logger){log=logger;}
    /**
     * Checks whether a virtual key is currently pressed.
     * @param key Virtual key or action key identifier.
     * @returns Whether the condition is satisfied.
     */
    static bool Held(int key){return (GetAsyncKeyState(key)&0x8000)!=0;}
    /**
     * Checks keys that must be released before issuing launcher or voice shortcuts.
     * @returns Whether the condition is satisfied.
     */
    static bool BusyKeys(){return Held(0x10)||Held(0x11)||Held(0x12)||Held(0x5b)||Held(0x5c)||Held(0x7a)||Held(0x79)||Held(0x20)||Held(0x04);}
    /**
     * Identifies the ZTools main search window using process, title and class.
     * @param process Executable name without extension.
     * @param title Fixed window title.
     * @param windowClass Native window class.
     * @returns Whether the condition is satisfied.
     */
    internal static bool MatchesSearch(string process,string title,string windowClass) {
        return string.Equals(process,"ZTools",StringComparison.OrdinalIgnoreCase)&&title=="ZTools"&&windowClass.StartsWith("Chrome_WidgetWin_",StringComparison.Ordinal);
    }
    /**
     * Checks a native window identity without reading its search text.
     * @param window Native window handle.
     * @returns Whether the condition is satisfied.
     */
    static bool IsSearch(IntPtr window){
        try{
            uint pid;GetWindowThreadProcessId(window,out pid);
            var title=new StringBuilder(256);var cls=new StringBuilder(128);
            GetWindowText(window,title,title.Capacity);GetClassName(window,cls,cls.Capacity);
            using(var process=Process.GetProcessById((int)pid))return MatchesSearch(process.ProcessName,title.ToString(),cls.ToString());
        }catch{return false;}
    }
    /**
     * Tracks observed panel visibility, not odd/even hotkey presses.
     * A panel that closes during the trigger consumes that trigger without a toggle.
     */
    internal sealed class StopGesture {
        public bool Pending {get;private set;}
        long lastVisible=-10000,pressed;bool sent;
        /**
         * Updates visibility timing without registering hooks or generating input.
         * @param now Monotonic time in milliseconds.
         * @param visible Whether the identified voice panel is visible.
         * @returns No value.
         */
        public void Observe(long now,bool visible){if(visible)lastVisible=now;else sent=false;}
        /**
         * Routes a trigger to the current or recently closed voice session without blind toggling.
         * @param now Monotonic time in milliseconds.
         * @param visible Whether the identified voice panel is visible.
         * @returns Whether the condition is satisfied.
         */
        public bool Press(long now,bool visible){
            if(Pending)return true;
            bool recent=now-lastVisible<=500;
            Observe(now,visible);
            if(!visible&&!recent)return false;
            if(sent&&visible)return true;
            pressed=now;Pending=true;return true;
        }
        /**
         * Cancels pending actions without generating any input.
         * @returns No value.
         */
        public void Cancel(){Pending=false;}
        /**
         * Advances the pure state machine and returns at most one action for this tick.
         * @param now Monotonic time in milliseconds.
         * @param visible Whether the identified voice panel is visible.
         * @param keysHeld Whether a conflicting key remains pressed.
         * @param allowedFocus Whether focus still permits stopping this voice session.
         * @param cancel Whether external input cancels the pending action.
         * @returns Action name or test summary; null when no action is due.
         */
        public string Step(long now,bool visible,bool keysHeld,bool allowedFocus,bool cancel){
            if(!Pending)return null;
            if(cancel||now-pressed>=1500||!allowedFocus){Pending=false;return "cancel";}
            if(keysHeld)return null;
            Pending=false;
            if(!visible)return "ended";
            sent=true;return "stop";
        }
    }
    /**
     * Identifies the observed WeType voice panel using fixed window metadata.
     * @param process Executable name without extension.
     * @param title Fixed window title.
     * @param windowClass Native window class.
     * @returns Whether the condition is satisfied.
     */
    internal static bool MatchesVoice(string process,string title,string windowClass){
        return process=="wetype_update"&&title=="语音输入"&&windowClass=="wetype.flutter.setting";
    }
    /**
     * Finds the visible WeType voice window without reading speech or UI contents.
     * @returns Native handle or callback result.
     */
    static IntPtr VoiceWindow(){
        IntPtr result=IntPtr.Zero;
        EnumWindows((window,parameter)=>{
            if(!IsWindowVisible(window))return true;
            var cls=new StringBuilder(128);GetClassName(window,cls,cls.Capacity);
            if(cls.ToString()!="wetype.flutter.setting")return true;
            var title=new StringBuilder(64);GetWindowText(window,title,title.Capacity);
            if(title.ToString()!="语音输入")return true;
            try{
                uint pid;GetWindowThreadProcessId(window,out pid);
                using(var process=Process.GetProcessById((int)pid)){
                    if(MatchesVoice(process.ProcessName,title.ToString(),cls.ToString())){result=window;return false;}
                }
            }catch{}
            return true;
        },IntPtr.Zero);
        return result;
    }
    /**
     * Starts a pending sequence or routes an observed live voice session to termination.
     * @param now Monotonic time in milliseconds.
     * @returns No value.
     */
    public void Start(long now){
        IntPtr foreground=GetForegroundWindow();
        bool visible=VoiceWindow()!=IntPtr.Zero;
        if(stop.Press(now,visible)){
            sequence.Cancel();stopOrigin=foreground;
            log("voice-search: finish requested");return;
        }
        if(!visible&&now-lastVoiceSent<800){log("voice-search: waiting for voice panel");return;}
        sequence.Start(now,foreground);
    }
    /**
     * Cancels pending actions without generating any input.
     * @returns No value.
     */
    public void Cancel(){sequence.Cancel();stop.Cancel();}
    /**
     * Builds one keyboard input record without sending it.
     * @param key Virtual key or action key identifier.
     * @param up Whether this is a key release.
     * @returns One keyboard input record.
     */
    static INPUT Key(ushort key,bool up){return new INPUT{type=1,data=new UNION{key=new KEY{vk=key,flags=(up?2u:0u)|(key==0x5b?1u:0u)}}};}
    /**
     * Returns the native voice toggle or launcher key sequence without sending it.
     * @param action Action name or deferred refresh callback.
     * @returns Virtual-key codes in press order.
     */
    internal static ushort[] Chord(string action){return action=="stop"||action=="voice"?new ushort[]{0xa2,0x5b,0x41}:new ushort[]{0xa2,0x20};}
    /**
     * Sends a shortcut and releases any partially injected key presses on failure.
     * @param keys Virtual-key codes in press order.
     * @returns Whether the condition is satisfied.
     */
    static bool SendChord(ushort[] keys){
        var events=new INPUT[keys.Length*2];
        for(int i=0;i<keys.Length;i++){events[i]=Key(keys[i],false);events[keys.Length+i]=Key(keys[keys.Length-1-i],true);}
        uint count=SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(INPUT)));
        if(count==events.Length)return true;
        // Only release keys whose down event was successfully injected.
        int pressed=Math.Min((int)count,keys.Length);
        for(int i=pressed-1;i>=0;i--)SendInput(1,new[]{Key(keys[i],true)},Marshal.SizeOf(typeof(INPUT)));
        return false;
    }
    /**
     * Advances pending input actions while rechecking focus and key-release boundaries.
     * @param now Monotonic time in milliseconds.
     * @returns No value.
     */
    public void Tick(long now){
        // Observe manual Esc, the back button, panel controls, and automatic closure.
        if(now>=nextObservation){PanelVisible=VoiceWindow()!=IntPtr.Zero;stop.Observe(now,PanelVisible);nextObservation=now+100;}
        if(!Active)return;
        IntPtr current=GetForegroundWindow();
        if(stop.Pending){
            IntPtr panel=VoiceWindow();
            bool allowed=current==stopOrigin&&(IsSearch(current)||current==panel);
            // A disappearing panel may return focus to the search box before release.
            if(panel==IntPtr.Zero)allowed=true;
            string ending=stop.Step(now,panel!=IntPtr.Zero,BusyKeys(),allowed,Held(0x1b)||Held(0x01)||Held(0x02));
            if(ending==null)return;
            if(ending=="stop"){
                // Toggle only a still-visible voice panel. Esc would clear/hide ZTools.
                if(GetForegroundWindow()!=current||BusyKeys()||VoiceWindow()!=panel){log("voice-search: finish skipped (state changed)");return;}
                log(SendChord(Chord("stop"))?"voice-search: sent stop (LeftCtrl+LeftWin+A)":"voice-search: stop input failed");
            }else log("voice-search: finish "+ending);
            return;
        }
        string action=sequence.Step(now,BusyKeys(),current,IsSearch(current),Held(0x1b)||Held(0x01)||Held(0x02));
        if(action==null)return;
        if(action=="cancel"){log("voice-search: cancelled (focus, input or timeout)");return;}
        // Revalidate just before injection; never redirect input into a different app.
        if(GetForegroundWindow()!=current||BusyKeys()||(action=="voice"&&!IsSearch(current))){Cancel();log("voice-search: cancelled before send");return;}
        if(!SendChord(Chord(action))){Cancel();log("voice-search: input injection failed");return;}
        if(action=="voice")lastVoiceSent=now;
        log("voice-search: sent "+action);
    }
    /**
     * Runs pure regression checks without creating windows, hooks, hotkeys or runtime files.
     * @returns Assertion count or operation status.
     * @throws Exception when validation or native initialization fails.
     */
    public static int Tests(){
        int n=0;Action<bool,string> check=(ok,name)=>{if(!ok)throw new Exception("Voice test failed: "+name);n++;};
        IntPtr a=new IntPtr(1),b=new IntPtr(2),c=new IntPtr(3);var s=new Sequence();
        s.Start(0,a);check(s.Step(10,true,a,false,false)==null,"wait for modifiers");
        check(s.Step(20,false,a,false,false)=="launch","launch once");
        check(s.Step(40,false,a,false,false)==null,"wait for launcher");
        check(s.Step(100,false,b,true,false)==null,"settle focus");
        check(s.Step(399,false,b,true,false)==null,"full settle time");
        check(s.Step(400,false,b,true,false)=="voice","voice after focus");
        check(s.Step(800,false,b,true,false)==null,"no duplicate");
        s.Start(1000,b);check(s.Step(1010,false,b,true,false)==null,"already open does not toggle");
        check(s.Step(1310,false,b,true,false)=="voice","already open voice");
        s.Start(2000,a);s.Step(2010,false,a,false,false);check(s.Step(2020,false,c,false,false)=="cancel","other app cancels");
        s.Start(3000,a);s.Step(3010,false,a,false,false);s.Step(3100,false,b,true,false);check(s.Step(3200,false,a,false,false)=="cancel","focus lost cancels");
        s.Start(4000,a);check(s.Step(4010,false,a,false,true)=="cancel","escape cancels");
        s.Start(5000,a);check(s.Step(8000,false,a,false,false)=="cancel","launch timeout");
        s.Start(9000,a);check(s.Step(9010,false,b,true,false)=="cancel","focus moved before launch");
        s.Start(10000,a);s.Start(11000,a);check(s.Step(13000,false,a,false,false)=="cancel","repeat does not extend timeout");
        s.Start(14000,a);check(s.Step(14001,false,IntPtr.Zero,false,false)=="cancel","no foreground");
        s.Start(15000,b);s.Step(15001,false,b,true,false);s.Step(15200,true,b,true,false);check(s.Step(15310,false,b,true,false)==null,"held keys reset settling");
        check(s.Step(15610,false,b,true,false)=="voice","settles after release");
        check(MatchesSearch("ZTools","ZTools","Chrome_WidgetWin_1"),"main window identity");
        check(!MatchesSearch("chrome","ZTools","Chrome_WidgetWin_1"),"browser rejected");
        check(!MatchesSearch("ZTools","计算稿纸","Chrome_WidgetWin_1"),"plugin rejected");
        check(!MatchesSearch("ZTools","ZTools","Other"),"wrong class rejected");
        var chord=Chord("voice");check(chord.Length==3&&chord[0]==0xa2&&chord[1]==0x5b&&chord[2]==0x41,"left ctrl win A");
        check(Marshal.SizeOf(typeof(INPUT))==40,"x64 input layout");
        check(MatchesVoice("wetype_update","语音输入","wetype.flutter.setting"),"observed voice panel identity");
        check(!MatchesVoice("wetype_renderer","WeType Native Candidate","WeType.NativeCandidate.Direct2D.v2"),"candidate is not voice");
        check(!MatchesVoice("wetype_update","设置","wetype.flutter.setting"),"settings is not voice");
        check(!MatchesVoice("other","语音输入","wetype.flutter.setting"),"other owner rejected");
        var t=new StopGesture();
        check(!t.Press(0,false),"initial press starts voice");
        t.Observe(100,true);check(t.Press(200,true),"visible voice routes to stop");
        check(t.Step(210,true,true,true,false)==null,"stop waits for modifier release");
        check(t.Step(220,true,false,true,false)=="stop","stop once after release");
        check(t.Step(230,true,false,true,false)==null,"no repeated escape");
        check(t.Press(240,true)&&!t.Pending,"processing panel cannot restart or stop twice");
        t.Observe(300,false);check(!t.Press(1000,false),"manual closure allows fresh session");
        t.Observe(1100,true);check(t.Press(1150,false),"trigger may have already ended voice");
        check(t.Step(1200,false,false,true,false)=="ended","no toggle after closure");
        t.Press(1500,true);check(t.Step(1510,true,false,false,false)=="cancel","stop cannot escape another app");
        t.Observe(1600,false);t.Press(1700,true);check(t.Step(1710,true,false,true,true)=="cancel","manual Escape cancels pending stop");
        t.Observe(1800,false);t.Press(1900,true);check(t.Step(3400,true,true,true,false)=="cancel","held stop expires");
        t.Observe(3500,false);t.Press(3600,true);check(t.Step(3610,false,true,true,false)==null,"closed panel still waits key release");
        check(t.Step(3620,false,false,true,false)=="ended","closure mid trigger cannot reopen");
        var stopChord=Chord("stop");
        check(stopChord.Length==3&&stopChord[0]==0xa2&&stopChord[1]==0x5b&&stopChord[2]==0x41,"stop uses native voice toggle");
        check(Array.IndexOf(stopChord,(ushort)0x1b)<0,"stop never sends Escape to ZTools");
        check(Array.IndexOf(stopChord,(ushort)0x20)<0&&Array.IndexOf(stopChord,(ushort)0x0d)<0,"stop never toggles launcher or presses Enter");
        return n;
    }
}
