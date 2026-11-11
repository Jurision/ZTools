import { parentPort, workerData } from 'node:worker_threads'
import { startFakeEverything } from './fakeEverything'
const items = Array.from({ length: 46000 }, (_, index) => ({
  path: `E:\\Synthetic\\资料${String(index).padStart(5, '0')}朱元欣.txt`,
  modified: Date.UTC(2026, 0, 1) + index
}))
/**
 * Start the large fake index off the measured main thread so fixture serialization does not pollute it.
 * @returns Resolves after publishing only the endpoint path.
 */
async function start(): Promise<void> {
  const fake = await startFakeEverything(items, workerData.directory)
  parentPort!.postMessage({ iniPath: fake.iniPath, count: items.length })
  parentPort!.on('message', () => {
    void fake.close().then(() => process.exit(0))
  })
}
void start()
