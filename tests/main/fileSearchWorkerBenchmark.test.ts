import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { FileSearchService } from '../../src/main/core/fileSearch/fileSearchService'
import { buildFileSearchTestWorker } from '../helpers/fileSearchWorker'
const require = createRequire(import.meta.url)
it('46k synthetic index ingestion and fuzzy queries keep the host event loop under20ms', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-index-benchmark-'))
  let server: Worker | undefined, service: FileSearchService | undefined
  try {
    const workerPath = await buildFileSearchTestWorker(directory)
    const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
    const serverPath = path.join(directory, 'fake-index.cjs')
    await esbuild.build({
      entryPoints: [path.resolve('tests/helpers/fileSearchBenchmarkServer.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: serverPath,
      logLevel: 'silent'
    })
    server = new Worker(serverPath, { workerData: { directory } })
    const endpoint = await new Promise<{ iniPath: string; count: number }>((resolve, reject) => {
      server!.once('message', resolve)
      server!.once('error', reject)
    })
    expect(endpoint.count).toBe(46000)
    vi.stubEnv('ZTOOLS_EVERYTHING_INI', endpoint.iniPath)
    service = new FileSearchService({ workerPath })
    const delay = monitorEventLoopDelay({ resolution: 1 })
    delay.enable()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const ingestStart = performance.now()
    await service.warmUp()
    const ingestMs = performance.now() - ingestStart
    const ingestionMaxMs = delay.max / 1e6
    delay.reset()
    const queryStart = performance.now()
    const result = await service.search({ query: 'zyx', mode: 'fuzzy', limit: 50 })
    const queryMs = performance.now() - queryStart
    const queryMaxMs = delay.max / 1e6
    delay.disable()
    expect(result.status).toBe('ok')
    expect(result.items).toHaveLength(50)
    console.log(
      JSON.stringify({ fixtureCount: 46000, ingestMs, queryMs, ingestionMaxMs, queryMaxMs })
    )
    expect(ingestionMaxMs).toBeLessThan(20)
    expect(queryMaxMs).toBeLessThan(20)
  } finally {
    await service?.dispose()
    await server?.terminate()
    vi.unstubAllEnvs()
    if (directory.startsWith(path.join(os.tmpdir(), 'ztools-index-benchmark-')))
      await fs.rm(directory, { recursive: true, force: true })
  }
}, 30000)
