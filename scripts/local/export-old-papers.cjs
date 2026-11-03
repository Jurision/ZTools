/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node CommonJS utility; return contracts are documented with JSDoc. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { open } = require('lmdb')
const profile = process.argv[2] && path.resolve(process.argv[2])
const output = process.argv[3] && path.resolve(process.argv[3])
if (!profile || !output)
  throw new Error(
    'Usage: node scripts/local/export-old-papers.cjs <ZTools-profile> <new-json-file>'
  )
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing export')
const prefix = 'PLUGIN/calculation-paper/'
/**
 * Open only an existing LMDB environment in read-only mode.
 * @param {string} folder Existing database directory.
 * @returns {{env: object, db: object}} Read-only environment and main database.
 * @throws {Error} The database does not exist.
 */
function readDatabase(folder) {
  if (!fs.existsSync(path.join(folder, 'data.mdb'))) throw new Error('Database missing: ' + folder)
  const env = open({
    path: folder,
    readOnly: true,
    maxDbs: 6,
    encoding: 'binary',
    compression: false
  })
  return { env, db: env.openDB({ name: 'main', encoding: 'string' }) }
}
const device = readDatabase(path.join(profile, 'lmdb/device'))
let uid
try {
  uid = JSON.parse(device.db.get('SYNC/current-account') || 'null')?.data?.uid
} finally {
  device.env.close()
}
const account =
  typeof uid === 'string' && uid.trim()
    ? crypto.createHash('sha256').update(uid.trim()).digest('hex').slice(0, 16)
    : 'default'
const source = readDatabase(path.join(profile, 'lmdb/accounts', account))
const papers = []
try {
  for (const { key, value } of source.db.getRange({
    start: prefix + 'paper/',
    end: prefix + 'paper0'
  })) {
    if (!key.startsWith(prefix + 'paper/')) continue
    const doc = JSON.parse(value)
    if (doc._deleted || !Array.isArray(doc.calcList)) continue
    papers.push({
      _id: doc._id.slice(prefix.length),
      label: doc.label,
      createAt: doc.createAt,
      calcList: doc.calcList.map((row) => ({ expression: row.expression, remark: row.remark }))
    })
  }
} finally {
  source.env.close()
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(
  output,
  JSON.stringify(
    { format: 'ztools-paper-export-v1', exportedAt: new Date().toISOString(), papers },
    null,
    2
  ),
  { flag: 'wx' }
)
console.log(JSON.stringify({ count: papers.length, output, sourceUnchanged: true }))
