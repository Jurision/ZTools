import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertBackgroundTestIsolation } from '../../src/main/core/backgroundTestMode'

describe('background test isolation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-background-policy-'))
  const home = path.join(root, 'home')
  const isolated = path.join(root, 'isolated')
  fs.mkdirSync(home, { recursive: true })
  const env = {
    ZTOOLS_BACKGROUND_TEST: '1',
    ZTOOLS_E2E: '1',
    ZTOOLS_DATA_ROOT: isolated,
    ZTOOLS_LEGACY_USER_DATA_PATH: path.join(isolated, 'legacy'),
    APPDATA: path.join(home, 'AppData', 'Roaming')
  }

  it('does not change the normal launch contract', () => {
    expect(() => assertBackgroundTestIsolation({}, home)).not.toThrow()
  })

  it('accepts separate, explicit profiles including a nested empty legacy root', () => {
    expect(() => assertBackgroundTestIsolation(env, home)).not.toThrow()
  })

  it('requires E2E and both absolute roots', () => {
    expect(() => assertBackgroundTestIsolation({ ...env, ZTOOLS_E2E: '' }, home)).toThrow()
    expect(() => assertBackgroundTestIsolation({ ...env, ZTOOLS_DATA_ROOT: '' }, home)).toThrow()
    expect(() =>
      assertBackgroundTestIsolation({ ...env, ZTOOLS_LEGACY_USER_DATA_PATH: 'relative' }, home)
    ).toThrow()
  })

  it('rejects live roots, their descendants and their ancestors for either profile', () => {
    for (const key of ['ZTOOLS_DATA_ROOT', 'ZTOOLS_LEGACY_USER_DATA_PATH']) {
      for (const value of [path.join(home, '.ztools'), path.join(home, '.ztools', 'test'), home]) {
        expect(() => assertBackgroundTestIsolation({ ...env, [key]: value }, home)).toThrow(
          /overlap/
        )
      }
    }
  })

  it('rejects a junction or symlink resolving into production data', () => {
    const live = path.join(home, '.ztools')
    const alias = path.join(root, 'linked-profile')
    fs.mkdirSync(live, { recursive: true })
    fs.symlinkSync(live, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() =>
      assertBackgroundTestIsolation({ ...env, ZTOOLS_DATA_ROOT: path.join(alias, 'new') }, home)
    ).toThrow(/overlap/)
  })
})
