import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Every test file gets a fresh profile before application imports, including
// ad-hoc vitest commands. Missing mocks must never initialize the live database.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-unit-profile-'))
const legacy = path.join(profile, 'legacy')
fs.mkdirSync(legacy)
process.env.ZTOOLS_DATA_ROOT = profile
process.env.ZTOOLS_LEGACY_USER_DATA_PATH = legacy
