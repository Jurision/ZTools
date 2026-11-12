using System;

/**
 * Separate console entry point: never starts the installed application's message loop.
 */
static class HelperSelfTest {
    /**
     * Reports pure state-machine checks to stdout; all files are managed by build.ps1.
     * @returns Zero on success, one on an assertion failure.
     */
    static int Main() {
        try {
            Console.WriteLine(HoldCopyPaste.Tests());
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
