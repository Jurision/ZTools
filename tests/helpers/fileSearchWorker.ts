import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
/**
 * Bundle the actual source worker into a test-only directory without building or packaging the app.
 * @param directory Existing isolated temporary directory.
 * @returns Path of the runnable worker entry.
 */
export async function buildFileSearchTestWorker(directory: string): Promise<string> {
  const viteRequire = createRequire(require.resolve('vite/package.json'))
  const esbuild = viteRequire('esbuild')
  const outfile = path.join(directory, 'fileSearchWorker.cjs')
  await esbuild.build({
    entryPoints: [path.resolve('src/main/core/fileSearch/fileSearchWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    alias: { '@shared': path.resolve('src/shared') },
    logLevel: 'silent'
  })
  return outfile
}
