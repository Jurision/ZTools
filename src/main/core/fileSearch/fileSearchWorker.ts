import { parentPort } from 'node:worker_threads'
import { FileSearchEngine } from './fileSearchEngine'
const engine = new FileSearchEngine()
/**
 * Handle small host operations entirely within the worker, including HTTP parsing and scoring.
 * @param message Worker RPC envelope.
 * @returns Completes after posting the result; no request failure escapes the worker.
 */
async function handle(message: {
  id: number
  action: string
  payload?: unknown
  iniPath: string | null
  explicitIni: boolean
}): Promise<void> {
  // An absent test endpoint cannot fall back to the real user's index.
  if (message.explicitIni || !message.iniPath)
    process.env.ZTOOLS_EVERYTHING_INI = message.iniPath || '__ztools_missing_endpoint__'
  else delete process.env.ZTOOLS_EVERYTHING_INI
  try {
    let result: unknown
    if (message.action === 'search') result = await engine.search(message.payload)
    else if (message.action === 'warmUp') result = await engine.warmUp()
    else if (message.action === 'existingPaths' && Array.isArray(message.payload))
      result = await engine.existingPaths(message.payload)
    else if (message.action === 'removePath' && typeof message.payload === 'string')
      result = engine.removePath(message.payload)
    parentPort!.postMessage({ id: message.id, result })
  } catch {
    parentPort!.postMessage({
      id: message.id,
      result: { status: 'unavailable', items: [], total: 0 }
    })
  }
}
parentPort!.on('message', (message) => {
  void handle(message)
})
parentPort!.on('close', () => engine.dispose())
