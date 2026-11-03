import { describe, expect, it } from 'vitest'
import {
  normalizeSuperPanelSize,
  resolveSuperPanelBounds
} from '../../src/main/core/superPanelLayout'

describe('super panel layout in Electron DIP coordinates', () => {
  it('rejects corrupt stored sizes and never retains position', () => {
    expect(normalizeSuperPanelSize({ width: NaN, height: -5, x: 900 })).toEqual({
      width: 250,
      height: 400
    })
    expect(normalizeSuperPanelSize({ width: 300.4, height: 100 })).toEqual({
      width: 300,
      height: 240
    })
  })

  it('fits negative-coordinate monitors and respects reserved taskbar space', () => {
    expect(
      resolveSuperPanelBounds(
        { x: -10, y: -20 },
        { width: 350, height: 500 },
        { x: -1280, y: -800, width: 1280, height: 760 }
      )
    ).toEqual({ x: -350, y: -540, width: 350, height: 500 })
  })

  it('uses DIP work area directly without multiplying high-DPI dimensions', () => {
    expect(
      resolveSuperPanelBounds(
        { x: 1500, y: 850 },
        { width: 400, height: 500 },
        { x: 0, y: 0, width: 1536, height: 824 }
      )
    ).toEqual({ x: 1136, y: 324, width: 400, height: 500 })
  })

  it('temporarily fits small displays without mutating the preferred size', () => {
    const size = { width: 700, height: 900 }
    expect(
      resolveSuperPanelBounds({ x: 100, y: 100 }, size, { x: 0, y: 0, width: 200, height: 180 })
    ).toEqual({ x: 0, y: 0, width: 200, height: 180 })
    expect(size).toEqual({ width: 700, height: 900 })
    expect(
      resolveSuperPanelBounds({ x: 50, y: 60 }, size, { x: 0, y: 0, width: 1920, height: 1080 })
    ).toEqual({ x: 50, y: 60, width: 700, height: 900 })
  })
})
