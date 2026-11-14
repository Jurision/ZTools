import { normalizeApplicationPath } from './applicationIdentity'

export interface ApplicationRegistration {
  id: string
  root: string
  name: string
  publisher?: string
  version?: string
}

/**
 * Normalize product metadata while treating a product's launcher as the same product component.
 * @param value Executable product or publisher metadata, not a search label.
 * @returns Comparable identity retaining version/channel digits.
 */
export function productFamily(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(?:\s*app)?[\s_-]*launcher$/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Resolve a product component to one registered installation using bounded, path-delimited ownership.
 * Shared suite directories are not sufficient: publisher and component product must also agree.
 * @param target Executable path.
 * @param product Executable product metadata.
 * @param publisher Executable company metadata.
 * @param registrations Current installation registrations; no stale cache is consulted.
 * @returns Stable component identity, or undefined when ownership is missing or ambiguous.
 */
export function installationIdentity(
  target: string,
  product: string | undefined,
  publisher: string | undefined,
  registrations: ApplicationRegistration[]
): string | undefined {
  const family = productFamily(product || '')
  const company = productFamily(publisher || '')
  if (!family || !company || /^(electron|chromium|nodejs|microsoftwindows)$/.test(family))
    return undefined
  const executable = normalizeApplicationPath(target)
  const owners = registrations
    .filter((registration) => {
      const root = normalizeApplicationPath(registration.root)
      // Registry publisher labels often abbreviate the executable's company (e.g. "Vendor Inc.").
      // Executable publisher remains part of the final identity, so different companies cannot merge.
      return root.length > 3 && executable.startsWith(root + '\\')
    })
    .sort((a, b) => b.root.length - a.root.length)
  if (!owners.length) return undefined
  const closest = owners.filter(
    (owner) => normalizeApplicationPath(owner.root) === normalizeApplicationPath(owners[0].root)
  )
  // Two real registrations sharing a root can represent side-by-side versions or separate sources.
  if (new Set(closest.map((owner) => owner.id)).size !== 1) return undefined
  return JSON.stringify([owners[0].id, normalizeApplicationPath(owners[0].root), family, company])
}
