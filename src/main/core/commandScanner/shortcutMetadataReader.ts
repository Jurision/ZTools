import type { Command } from './types'
import type { ShortcutLaunchMetadata } from './windowsInstalledApps'

export interface ShortcutMetadataPage {
  shortcuts?: ShortcutLaunchMetadata[]
  complete: boolean
  processed?: number
}

/**
 * Read shortcut identities in resumable bounded pages instead of one global five-second pass.
 * @param entries Current shortcut inventory; no installed application is executed.
 * @param readPage Hidden helper invocation for one page.
 * @param now Monotonic-enough clock injected by tests for deadline coverage.
 * @returns Accumulated metadata and completeness; failure never masquerades as an empty full scan.
 */
export async function collectShortcutMetadata(
  entries: Command[],
  readPage: (entries: Command[]) => Promise<ShortcutMetadataPage>,
  now: () => number = Date.now
): Promise<{ shortcuts: ShortcutLaunchMetadata[]; complete: boolean }> {
  const links = entries.filter((entry) => /\.lnk$/i.test(entry.path))
  const shortcuts: ShortcutLaunchMetadata[] = []
  const deadline = now() + 60_000
  let offset = 0
  while (offset < links.length && now() < deadline) {
    const page = links.slice(offset, offset + 64)
    const result = await readPage(page)
    const processed = result.processed ?? (result.complete ? page.length : 0)
    // Reject a stalled/malformed cursor; the watcher retries later without replacing a good cache.
    if (
      !Number.isInteger(processed) ||
      processed <= 0 ||
      processed > page.length ||
      (!result.complete && processed === page.length)
    )
      return { shortcuts, complete: false }
    shortcuts.push(...(result.shortcuts || []))
    offset += processed
  }
  return { shortcuts, complete: offset === links.length }
}
