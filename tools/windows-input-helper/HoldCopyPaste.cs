using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;

// Ctrl+Shift+F10 from ATK keeps the original copy/paste state machine.
// Voice search additionally receives physical middle clicks on a separate hook thread.
class HoldCopyPaste : NativeWindow, IDisposable {
    [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h,int id);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
    [StructLayout(LayoutKind.Explicit)] struct UNION {
        [FieldOffset(0)] public KEY key;
        [FieldOffset(0)] public MOUSE mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
    static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ZToolsSmartCopyPaste");
    /**
     * Writes bounded local diagnostic metadata without recording clipboard or speech content.
     * @param value Diagnostic metadata, never user text.
     * @returns No value.
     */
    static void Log(string value){string path=Path.Combine(Root,"status.log");if(File.Exists(path)&&new FileInfo(path).Length>65536)File.WriteAllText(path,"");File.AppendAllText(path,DateTime.Now.ToString("s")+" "+value+Environment.NewLine);}
    /**
     * Checks whether a virtual key is currently pressed.
     * @param vk Virtual-key code.
     * @returns Whether the condition is satisfied.
     */
    static bool Held(int vk){return (GetAsyncKeyState(vk)&0x8000)!=0;}
    /**
     * Checks whether any modifier would contaminate a generated shortcut.
     * @returns Whether the condition is satisfied.
     */
    static bool ModifiersHeld(){return Held(0x10)||Held(0x11)||Held(0x12)||Held(0x5b)||Held(0x5c);}
    public sealed class Gesture {
        public bool Active; public long DurationMs; long down; long released=-1; bool cancelled; string pending;
        /**
         * Begins a copy/paste gesture without resetting a gesture already in progress.
         * @param now Monotonic time in milliseconds.
         * @returns No value.
         */
        public void Down(long now){if(Active)return;Active=true;down=now;released=-1;cancelled=false;pending=null;}
        /**
         * Advances pending input actions while rechecking focus and key-release boundaries.
         * @param now Monotonic time in milliseconds.
         * @param f10 Whether the mapped F10 key is held.
         * @param modifiers Whether any modifier key is held.
         * @param sameWindow Whether the original target still owns focus.
         * @returns Action name or test summary; null when no action is due.
         */
        public string Tick(long now,bool f10,bool modifiers,bool sameWindow){
            if(!Active)return null;
            if(!sameWindow||now-down>=30000)cancelled=true;
            if(released<0&&!f10){released=now;DurationMs=now-down;pending=DurationMs>=300?"paste":"copy";}
            if(released<0)return null;
            if(f10||now-released>1000)cancelled=true;
            if(modifiers&&now-released<=1000)return null;
            Active=false;
            return cancelled?"cancel":pending;
        }
    }
    readonly Gesture gesture=new Gesture();
    readonly Stopwatch watch=Stopwatch.StartNew();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly VoiceSearch voice=new VoiceSearch(Log);
    MiddleButtonInput middle;
    IntPtr target;uint targetPid;bool registered;uint clipboardAtDown;
    /**
     * Creates the message window, registers shortcuts and starts independent input handling.
     * @returns No value.
     * @throws Exception when validation or native initialization fails.
     */
    public HoldCopyPaste(){
        CreateHandle(new CreateParams{Caption="SideKeyHoldCopyPaste",Parent=new IntPtr(-3)});
        if(!RegisterHotKey(Handle,1,0x4006,0x79))throw new Exception("Hotkey unavailable: "+Marshal.GetLastWin32Error());
        registered=true;timer.Interval=15;timer.Tick+=(s,e)=>Tick();timer.Start();
        if(!RegisterHotKey(Handle,2,0x4006,0x7a)){UnregisterHotKey(Handle,1);throw new Exception("Voice search hotkey Ctrl+Shift+F11 unavailable: "+Marshal.GetLastWin32Error());}
        Log("ready: hold mode; Ctrl+Shift+F10; short=copy long>=300ms=paste; execute on release");
        Log("ready: voice search Ctrl+Shift+F11 -> Ctrl+Space -> LeftCtrl+LeftWin+A");
        try{middle=new MiddleButtonInput(Handle);Log("ready: physical middle -> internal voice request; other mouse input passes through");}
        catch(Exception ex){Log("error: physical middle unavailable; copy/paste remains active; "+ex.Message);}
    }
    /**
     * Dispatches internal messages and forwards ordinary window messages to the base handler.
     * @param message Native message or message identifier.
     * @returns No value.
     */
    protected override void WndProc(ref Message message){
        if(message.Msg==MiddleButtonInput.RefreshedMessage)Log("voice-search: middle interception refreshed after voice start");
        if(message.Msg==MiddleButtonInput.RefreshFailedMessage)Log("error: middle interception refresh failed; code="+message.WParam);
        if(message.Msg==MiddleButtonInput.Message&&!gesture.Active){Log("voice-search: physical middle request");voice.Start(watch.ElapsedMilliseconds);}
        if(message.Msg==0x312&&message.WParam.ToInt32()==2){if(!gesture.Active)voice.Start(watch.ElapsedMilliseconds);}
        if(message.Msg==0x312&&message.WParam.ToInt32()==1&&!gesture.Active){voice.Cancel();target=GetForegroundWindow();GetWindowThreadProcessId(target,out targetPid);clipboardAtDown=GetClipboardSequenceNumber();gesture.Down(watch.ElapsedMilliseconds);}
        base.WndProc(ref message);
    }
    /**
     * Advances pending input actions while rechecking focus and key-release boundaries.
     * @returns No value.
     */
    void Tick(){
        voice.Tick(watch.ElapsedMilliseconds);
        if(middle!=null)middle.ObserveVoice(watch.ElapsedMilliseconds,voice.PanelVisible);
        if(!gesture.Active)return;
        uint currentPid;IntPtr current=GetForegroundWindow();GetWindowThreadProcessId(current,out currentPid);
        string action=gesture.Tick(watch.ElapsedMilliseconds,Held(0x79),ModifiersHeld(),target!=IntPtr.Zero&&current==target&&currentPid==targetPid);
        if(action==null)return;
        if(action=="cancel"){Log("skip: hold cancelled (focus changed or timeout)");return;}
        try{
            string proc=Process.GetProcessById((int)targetPid).ProcessName.ToLowerInvariant();
            if(proc.Contains("terminal")||proc=="cmd"||proc=="powershell"||proc=="pwsh"){Log("skip: terminal");return;}
            if(GetForegroundWindow()!=target||Held(0x79)||ModifiersHeld()){Log("skip: input changed before send");return;}
            ushort key=(ushort)(action=="copy"?0x43:0x56);
            uint clipboardBeforeSend=GetClipboardSequenceNumber();
            INPUT[] events={Key(0x11,false),Key(key,false),Key(key,true),Key(0x11,true)};
            uint sent=SendInput(4,events,Marshal.SizeOf(typeof(INPUT)));
            if(sent!=4){if(sent>0)SendInput(2,new[]{Key(key,true),Key(0x11,true)},Marshal.SizeOf(typeof(INPUT)));Log("error: incomplete key injection");return;}
            Log("sent: "+action+"; mode=hold; app="+proc+"; heldMs="+gesture.DurationMs+"; clipboardChangedDuringHold="+(clipboardBeforeSend!=clipboardAtDown)+"; clipboardSeq="+clipboardBeforeSend);
        }catch(Exception ex){Log("error: "+ex.GetType().Name);}
    }
    /**
     * Builds one keyboard input record without sending it.
     * @param key Virtual key or action key identifier.
     * @param up Whether this is a key release.
     * @returns One keyboard input record.
     */
    static INPUT Key(ushort key,bool up){return new INPUT{type=1,data=new UNION{key=new KEY{vk=key,flags=up?2u:0u}}};}
    /**
     * Releases owned timers, window handles or hook-thread resources.
     * @returns No value.
     */
    public void Dispose(){if(middle!=null)middle.Dispose();timer.Stop();timer.Dispose();if(registered){UnregisterHotKey(Handle,1);UnregisterHotKey(Handle,2);}DestroyHandle();}
    /**
     * Fails immediately when a regression assertion is false.
     * @param ok Whether the assertion passed.
     * @param name Non-sensitive assertion label.
     * @returns No value.
     * @throws Exception when validation or native initialization fails.
     */
    static void Assert(bool ok,string name){if(!ok)throw new Exception("Test failed: "+name);}
    /**
     * Runs pure regression checks without creating windows, hooks, hotkeys or runtime files.
     * @returns Action name or test summary; null when no action is due.
     * @throws Exception when validation or native initialization fails.
     */
    internal static string Tests(){
        var g=new Gesture();g.Down(0);Assert(g.Tick(100,true,true,true)==null,"no action while held");Assert(g.Tick(150,false,false,true)=="copy","short copies");Assert(g.Tick(200,false,false,true)==null,"short once");
        g.Down(1000);Assert(g.Tick(1600,true,true,true)==null,"long waits for release");Assert(g.Tick(3500,false,false,true)=="paste","long pastes");Assert(g.Tick(3600,false,false,true)==null,"long once");
        g.Down(4000);g.Down(4400);Assert(g.Tick(4550,false,false,true)=="paste","repeated hotkey does not reset timer");
        g.Down(5000);Assert(g.Tick(5100,false,true,true)==null,"wait modifiers");Assert(g.Tick(5150,false,false,true)=="copy","release modifiers");
        g.Down(6000);g.Tick(6100,true,true,false);Assert(g.Tick(6200,false,false,true)=="cancel","focus change latched");
        g.Down(7000);g.Tick(7100,false,true,true);Assert(g.Tick(8200,false,true,true)=="cancel","modifier timeout");
        g.Down(9000);Assert(g.Tick(9300,false,false,true)=="paste","threshold");
        g.Down(10000);Assert(g.Tick(40001,false,false,true)=="cancel","maximum duration");
        Assert(Marshal.SizeOf(typeof(INPUT))==40,"x64 INPUT layout");
        int voiceTests=VoiceSearch.Tests();
        int middleTests=MiddleButtonInput.Tests();
        return "PASS: 14 copy/paste + "+voiceTests+" voice + "+middleTests+" middle-button assertions; no input sent.";
    }
    /**
     * Starts the single-instance helper or the legacy installed self-test mode.
     * @param args Empty for normal startup, or --selftest for the legacy local report.
     * @returns Zero on success, one on failure.
     */
    [STAThread] static int Main(string[] args){
        try{
            Directory.CreateDirectory(Root);
            if(args.Length==1&&args[0]=="--selftest"){File.WriteAllText(Path.Combine(Root,"hold-selftest.txt"),Tests());return 0;}
            if(args.Length!=0)throw new Exception("Unknown arguments");
            bool created;using(var mutex=new Mutex(true,"Local\\ZToolsSmartCopyPaste",out created)){if(!created)return 0;using(var app=new HoldCopyPaste())Application.Run();}
            return 0;
        }catch(Exception ex){Log("error: "+ex.Message);return 1;}
    }
}
