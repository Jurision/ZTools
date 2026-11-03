/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Standalone Node CommonJS utility with JSDoc return contracts. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root }
)
  .toString()
  .split('\0')
  .filter(Boolean)
  .filter((name) => !name.endsWith('.tsbuildinfo'))
  .sort()
const digest = crypto.createHash('sha256')
/**
 * Hash files and submodule directory contents without following symlinks.
 * @param {string} file Absolute source path.
 * @returns {void} Updates the running digest.
 */
function hashPath(file) {
  if (!fs.existsSync(file)) {
    digest.update('<deleted>')
    return
  }
  const info = fs.lstatSync(file)
  if (info.isSymbolicLink()) {
    digest.update(fs.readlinkSync(file))
    return
  }
  if (info.isDirectory()) {
    digest.update('<directory>')
    for (const child of fs.readdirSync(file).sort()) {
      if (child === '.git' || child === 'node_modules') continue
      digest.update(child + '\0')
      hashPath(path.join(file, child))
    }
    return
  }
  digest.update(fs.readFileSync(file))
}
for (const name of [...new Set(files)]) {
  digest.update(name + '\0')
  const file = path.join(root, name)
  hashPath(file)
}
console.log(digest.digest('hex'))
