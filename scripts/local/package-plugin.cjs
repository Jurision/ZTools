/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS utility. */
const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')
const release = path.resolve(process.argv[2] || '')
const releases = path.resolve(__dirname, '../../.local-work/releases') + path.sep
if (!release.startsWith(releases))
  throw new Error('Release must be inside local releases directory')
const source = path.resolve(__dirname, '../../local-plugins/calculation-paper-next')
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'))
const zip = new AdmZip()
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (entry.name.includes('.test.') || entry.name.endsWith('.md')) continue
  if (entry.isDirectory()) zip.addLocalFolder(path.join(source, entry.name), entry.name)
  else zip.addLocalFile(path.join(source, entry.name))
}
const target = path.join(release, `${manifest.name}-${manifest.version}.zip`)
zip.writeZip(target)
console.log(target)
