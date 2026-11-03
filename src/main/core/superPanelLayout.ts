export const DEFAULT_SUPER_PANEL_SIZE = { width: 250, height: 400 }
export const MIN_SUPER_PANEL_SIZE = { width: 250, height: 240 }

interface Size {
  width: number
  height: number
}

interface Rectangle extends Size {
  x: number
  y: number
}

/**
 * Validate stored dimensions without retaining any saved screen position.
 * @param value Untrusted persisted panel size.
 * @returns Rounded positive dimensions with the minimum usable size applied.
 */
export function normalizeSuperPanelSize(value: unknown): Size {
  const size = value as Partial<Size> | null
  return {
    width:
      typeof size?.width === 'number' && Number.isFinite(size.width) && size.width > 0
        ? Math.max(MIN_SUPER_PANEL_SIZE.width, Math.round(size.width))
        : DEFAULT_SUPER_PANEL_SIZE.width,
    height:
      typeof size?.height === 'number' && Number.isFinite(size.height) && size.height > 0
        ? Math.max(MIN_SUPER_PANEL_SIZE.height, Math.round(size.height))
        : DEFAULT_SUPER_PANEL_SIZE.height
  }
}

/**
 * Fit a panel to the cursor's display using Electron DIP coordinates throughout.
 * @param point Current summon location, including negative monitor coordinates.
 * @param size Preferred size; fitting a smaller display must not overwrite it.
 * @param workArea Display bounds excluding taskbars and other reserved space.
 * @returns A visible panel rectangle contained within that display's work area.
 */
export function resolveSuperPanelBounds(
  point: { x: number; y: number },
  size: unknown,
  workArea: Rectangle
): Rectangle {
  const preferred = normalizeSuperPanelSize(size)
  const width = Math.min(preferred.width, Math.max(1, Math.floor(workArea.width)))
  const height = Math.min(preferred.height, Math.max(1, Math.floor(workArea.height)))
  return {
    x: Math.max(workArea.x, Math.min(Math.round(point.x), workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(Math.round(point.y), workArea.y + workArea.height - height)),
    width,
    height
  }
}
