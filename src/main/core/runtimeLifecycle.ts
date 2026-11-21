import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export type RuntimePhase =
  | 'started'
  | 'quit-requested'
  | 'quit-blocked'
  | 'listeners-stopped'
  | 'will-quit'
  | 'exit'

/**
 * Record bounded, synchronous lifecycle evidence without search text, clipboard data or credentials.
 * @param directory Application log directory (an isolated directory in tests).
 * @param pid Process identity, used to distinguish simultaneous test or launcher instances.
 * @returns A non-throwing writer for known lifecycle phases and an optional exit code.
 */
export function createRuntimeLifecycleRecorder(
  directory: string,
  pid: number
): (phase: RuntimePhase, exitCode?: number) => void {
  const file = path.join(directory, 'runtime-lifecycle.jsonl')
  return (phase: RuntimePhase, exitCode?: number): void => {
    try {
      mkdirSync(directory, { recursive: true })
      // Bound disk use while retaining the preceding run when the main log ends abruptly.
      if (existsSync(file) && statSync(file).size > 256 * 1024) {
        rmSync(file + '.1', { force: true })
        renameSync(file, file + '.1')
      }
      appendFileSync(
        file,
        JSON.stringify({ at: new Date().toISOString(), pid, phase, exitCode }) + '\n'
      )
    } catch {
      // A full disk or unavailable log directory must never prevent listener teardown.
    }
  }
}
