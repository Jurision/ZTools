import { app } from 'electron'
import { getZToolsRoot } from './appDataPaths'
import { assertBackgroundTestIsolation } from '../backgroundTestMode'

const LEGACY_USER_DATA_ENV = 'ZTOOLS_LEGACY_USER_DATA_PATH'

/**
 * Validate test isolation before selecting or migrating the application's data root.
 * @returns No value after the root has been configured.
 * @throws When a background test would access production data.
 */
export function configureAppDataRoot(): void {
  assertBackgroundTestIsolation()
  if (!process.env[LEGACY_USER_DATA_ENV]) {
    process.env[LEGACY_USER_DATA_ENV] = app.getPath('userData')
  }
  const root = getZToolsRoot()
  if (app.getPath('userData') !== root) {
    app.setPath('userData', root)
  }
}

configureAppDataRoot()
