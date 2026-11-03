import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Read the explicit background test flag without enabling it for ordinary E2E.
 * @returns Whether the current process requested hidden background testing.
 */
export function isBackgroundTest(): boolean {
  return process.env.ZTOOLS_BACKGROUND_TEST === '1'
}

/**
 * Resolve existing ancestors so junctions cannot redirect a fixture into live data.
 * @param input Absolute fixture or protected directory.
 * @returns Canonical absolute directory, including not-yet-created suffixes.
 */
function canonicalPath(input: string): string {
  let existing = path.resolve(input)
  const suffix: string[] = []
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    suffix.unshift(path.basename(existing))
    existing = path.dirname(existing)
  }
  const resolved = path.join(fs.realpathSync(existing), ...suffix)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Reject background tests before any database is imported unless all profiles are isolated.
 * @param env Environment to validate; defaults to the current process.
 * @param home User home containing the protected production data directory.
 * @returns No value when background mode is absent or safely configured.
 * @throws When E2E isolation is missing, relative, aliases live data or encloses live data.
 */
export function assertBackgroundTestIsolation(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): void {
  if (env.ZTOOLS_BACKGROUND_TEST !== '1') return
  if (env.ZTOOLS_E2E !== '1') throw new Error('Background tests require ZTOOLS_E2E=1')
  const live = [path.join(home, '.ztools'), path.join(home, '.config', 'ZTools')]
  if (process.platform === 'win32') {
    live.push(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ZTools'))
  } else if (process.platform === 'darwin') {
    live.push(path.join(home, 'Library', 'Application Support', 'ZTools'))
  }
  // Validate both roots before configureAppDataRoot can create/migrate any storage.
  for (const key of ['ZTOOLS_DATA_ROOT', 'ZTOOLS_LEGACY_USER_DATA_PATH']) {
    const value = env[key]
    if (!value || !path.isAbsolute(value))
      throw new Error(`Background tests require absolute ${key}`)
    const candidate = canonicalPath(value)
    for (const protectedPath of live.map(canonicalPath)) {
      const inside = path.relative(protectedPath, candidate)
      const enclosing = path.relative(candidate, protectedPath)
      if (
        !inside ||
        (!inside.startsWith('..' + path.sep) && inside !== '..' && !path.isAbsolute(inside)) ||
        !enclosing ||
        (!enclosing.startsWith('..' + path.sep) &&
          enclosing !== '..' &&
          !path.isAbsolute(enclosing))
      ) {
        throw new Error(`${key} must not overlap production ZTools data`)
      }
    }
  }
}
