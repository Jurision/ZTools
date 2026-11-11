/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Local Node build script. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '../..')
const source =
  process.argv[2] || path.join(root, '.local-work/fixtures/calculation-paper-original.asar')
const output = path.join(root, '.local-work/plugins/calculation-paper-next')
const original = asar.extractFile(source, 'index.js')
if (
  crypto.createHash('sha256').update(original).digest('hex') !==
  'f501c6389c211754cf459253c9e6f9d204b44d59cc65b08b29e30665a535a54a'
)
  throw new Error('Unsupported original calculator build; no output written')
/**
 * Apply one exact, version-guarded integration hook.
 * @param {string} text Original bundle.
 * @param {string} needle Unique original fragment.
 * @param {string} replacement Extension fragment.
 * @returns {string} Patched bundle.
 */
function once(text, needle, replacement) {
  if (text.split(needle).length !== 2) throw new Error('Original integration anchor changed')
  return text.replace(needle, replacement)
}
let script = once(
  original.toString(),
  '.render(t.createElement(hC,null))',
  '.render(t.createElement(window.PaperHistory.extend(hC),null))'
)
script = once(script, 's(t),e(t.calcList)', 's(t),e(t.calcList,t._id)')
script = once(
  script,
  'r.splice(r.indexOf(a),1),n(r)',
  'window.PaperHistory.removed(a._id),r.splice(r.indexOf(a),1),n(r)'
)
fs.mkdirSync(output, { recursive: true })
for (const name of [
  'logo.png',
  'index.js.LICENSE.txt',
  'res/average.svg',
  'res/equals.svg',
  'res/sum.svg'
]) {
  const target = path.join(output, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, asar.extractFile(source, name))
}
const manifest = JSON.parse(asar.extractFile(source, 'plugin.json').toString())
manifest.name = 'calculation-paper-next'
manifest.version = '0.2.1'
manifest.pluginName = manifest.title = '计算稿纸（本地历史增强）'
manifest.description = '保留原版计算稿纸，新增自动保存和日期历史'
fs.writeFileSync(path.join(output, 'plugin.json'), JSON.stringify(manifest, null, 2))
fs.writeFileSync(path.join(output, 'index.js'), script)
fs.writeFileSync(
  path.join(output, 'index.html'),
  '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="history.css"></head><body><div id="root"></div><script src="core.js"></script><script src="history.js"></script><script src="index.js"></script></body></html>'
)
for (const name of ['history.js', 'history.css'])
  fs.copyFileSync(
    path.join(root, 'local-plugins/calculation-paper-history', name),
    path.join(output, name)
  )
fs.copyFileSync(
  path.join(root, 'local-plugins/calculation-paper-next/core.js'),
  path.join(output, 'core.js')
)
// Isolated test fixture contains the exact original editor and engine, never user records.
const baseline = path.join(root, '.local-work/plugins/calculation-paper-baseline')
fs.mkdirSync(baseline, { recursive: true })
for (const name of [
  'index.html',
  'index.js',
  'index.js.LICENSE.txt',
  'logo.png',
  'res/average.svg',
  'res/equals.svg',
  'res/sum.svg'
]) {
  const target = path.join(baseline, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, asar.extractFile(source, name))
}
const baselineManifest = JSON.parse(asar.extractFile(source, 'plugin.json').toString())
baselineManifest.name = 'calculation-paper-baseline'
fs.writeFileSync(path.join(baseline, 'plugin.json'), JSON.stringify(baselineManifest, null, 2))
console.log(output)
