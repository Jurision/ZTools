import { describe, expect, it, vi } from 'vitest'
import { MonitorSubscription } from '../../src/main/core/native/monitorSubscription'
import { createRuntimeCleanup } from '../../src/main/core/runtimeCleanup'

describe('native listener lifecycle', () => {
  it('invalidates callbacks before stop drains them, and ignores events from prior generations', () => {
    const subscription = new MonitorSubscription<[number], { shouldBlock: boolean }>()
    const callbacks: Array<(value: number) => unknown> = []
    const first = vi.fn(() => ({ shouldBlock: true }))
    const second = vi.fn(() => ({ shouldBlock: false }))
    const stop = vi.fn(() => callbacks[0](9))
    subscription.start(first, (dispatch) => callbacks.push(dispatch), stop)
    expect(callbacks[0](1)).toEqual({ shouldBlock: true })
    subscription.stop()
    subscription.stop()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    subscription.start(second, (dispatch) => callbacks.push(dispatch), stop)
    expect(callbacks[0](2)).toBeUndefined()
    expect(callbacks[1](3)).toEqual({ shouldBlock: false })
    expect(second).toHaveBeenCalledExactlyOnceWith(3)
    subscription.stop()
  })

  it('unwinds partial startup without masking its error and requires release before restart', () => {
    const subscription = new MonitorSubscription()
    const callback = vi.fn()
    const stop = vi.fn<() => void>(() => {
      throw new Error('stop failed')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() =>
        subscription.start(
          callback,
          () => {
            throw new Error('start failed')
          },
          stop
        )
      ).toThrow('start failed')
      expect(subscription.active).toBe(false)
      expect(stop).toHaveBeenCalledTimes(1)
      expect(() =>
        subscription.start(
          callback,
          () => {},
          () => {}
        )
      ).toThrow('release did not complete')
      stop.mockImplementation(() => {})
      subscription.stop()
      subscription.start(
        callback,
        (dispatch) => dispatch(),
        () => {}
      )
      expect(callback).toHaveBeenCalledTimes(1)
      subscription.stop()
    } finally {
      log.mockRestore()
    }
  })

  it('rejects duplicate starts without losing ownership of the active native thread', () => {
    const subscription = new MonitorSubscription()
    const stop = vi.fn()
    subscription.start(
      () => {},
      () => {},
      stop
    )
    expect(() =>
      subscription.start(
        () => {},
        () => {},
        vi.fn()
      )
    ).toThrow('already running')
    subscription.stop()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not deliver late callbacks even if native stop throws', () => {
    const subscription = new MonitorSubscription()
    let emit: () => void = () => {}
    const callback = vi.fn()
    const stop = vi.fn<() => void>(() => {
      throw new Error('stop')
    })
    subscription.start(
      callback,
      (dispatch) => {
        emit = dispatch
      },
      stop
    )
    expect(() => subscription.stop()).toThrow('stop')
    expect(subscription.active).toBe(false)
    emit()
    expect(callback).not.toHaveBeenCalled()
    stop.mockImplementation(() => {})
    expect(() => subscription.stop()).not.toThrow()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})

describe('runtime shutdown barrier', () => {
  it('releases every resource in order, once, despite a failing or reentrant step', () => {
    const events: string[] = []
    const cleanup = createRuntimeCleanup(
      [
        {
          name: 'mouse',
          stop: () => {
            events.push('mouse')
            cleanup()
            throw new Error('native stop')
          }
        },
        {
          name: 'clipboard-window',
          stop: () => {
            events.push('clipboard-window')
          }
        },
        {
          name: 'uwp',
          stop: () => {
            events.push('uwp')
          }
        }
      ],
      () => {
        events.push('reported')
      }
    )
    cleanup()
    events.push('destroy-windows', 'close-database')
    cleanup()
    expect(events).toEqual([
      'mouse',
      'reported',
      'clipboard-window',
      'uwp',
      'destroy-windows',
      'close-database'
    ])
  })

  it('still releases remaining resources if the error reporter is already unavailable', () => {
    const stop = vi.fn()
    createRuntimeCleanup(
      [
        {
          name: 'broken',
          stop: () => {
            throw new Error('native')
          }
        },
        { name: 'other', stop }
      ],
      () => {
        throw new Error('logger closed')
      }
    )()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
