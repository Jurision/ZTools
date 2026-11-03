import { expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { open } from 'lmdb'

test('old-paper export is namespace-scoped, non-destructive and refuses overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-paper-export-test-'))
  const profile = path.join(root, 'profile')
  for (const subpath of ['device', 'accounts/default']) {
    const folder = path.join(profile, 'lmdb', subpath)
    fs.mkdirSync(folder, { recursive: true })
    const env = open({ path: folder, maxDbs: 6, encoding: 'binary', compression: false })
    const db = env.openDB<string>({ name: 'main', encoding: 'string' })
    if (subpath !== 'device') {
      db.putSync(
        'PLUGIN/calculation-paper/paper/123',
        JSON.stringify({
          _id: 'PLUGIN/calculation-paper/paper/123',
          label: 'fixture',
          calcList: [{ expression: '1+2', remark: 'test' }]
        })
      )
      db.putSync(
        'PLUGIN/other/paper/456',
        JSON.stringify({
          _id: 'PLUGIN/other/paper/456',
          calcList: [{ expression: 'private-other' }]
        })
      )
    }
    env.close()
  }
  const output = path.join(root, 'papers.json')
  const script = path.resolve('scripts/local/export-old-papers.cjs')
  const result = execFileSync(process.execPath, [script, profile, output], { encoding: 'utf8' })
  expect(JSON.parse(result).count).toBe(1)
  expect(JSON.parse(fs.readFileSync(output, 'utf8')).papers).toEqual([
    { _id: 'paper/123', label: 'fixture', calcList: [{ expression: '1+2', remark: 'test' }] }
  ])
  expect(() =>
    execFileSync(process.execPath, [script, profile, output], { stdio: 'pipe' })
  ).toThrow()
  const env = open({
    path: path.join(profile, 'lmdb/accounts/default'),
    maxDbs: 6,
    encoding: 'binary',
    compression: false,
    readOnly: true
  })
  const db = env.openDB<string>({ name: 'main', encoding: 'string' })
  expect(db.get('PLUGIN/calculation-paper/paper/123')).toContain('fixture')
  expect(db.get('PLUGIN/other/paper/456')).toContain('private-other')
  env.close()
})
