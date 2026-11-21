import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeLifecycleRecorder } from '../../src/main/core/runtimeLifecycle'

describe('runtime lifecycle evidence', () => {
  it('records exit ordering and code without arbitrary input payloads', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ztools-lifecycle-unit-'))
    const record = createRuntimeLifecycleRecorder(root, 123)
    record('started')
    record('listeners-stopped')
    record('exit', 0)
    const rows = readFileSync(path.join(root, 'runtime-lifecycle.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rows.map((row) => row.phase)).toEqual(['started', 'listeners-stopped', 'exit'])
    expect(rows[2].exitCode).toBe(0)
    expect(Object.keys(rows[0]).sort()).toEqual(['at', 'phase', 'pid'])
  })

  it('rotates bounded logs and never throws when the destination is unwritable', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ztools-lifecycle-unit-'))
    const file = path.join(root, 'runtime-lifecycle.jsonl')
    writeFileSync(file, 'x'.repeat(256 * 1024 + 1))
    createRuntimeLifecycleRecorder(root, 123)('started')
    expect(readFileSync(file + '.1', 'utf8')).toHaveLength(256 * 1024 + 1)
    expect(JSON.parse(readFileSync(file, 'utf8')).phase).toBe('started')
    expect(() => createRuntimeLifecycleRecorder(file, 123)('exit', 1)).not.toThrow()
  })
})
