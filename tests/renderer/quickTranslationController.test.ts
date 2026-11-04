import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createQuickTranslationController,
  type QuickTranslationState,
  type QuickTranslationResult
} from '../../src/renderer/src/composables/quickTranslationController'
const context = { hasAppMatches: false }
describe('quick translation controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('waits 400ms and sends only the latest eligible input', async () => {
    const translate = vi.fn(async () => ({ text: '你好' }))
    const controller = createQuickTranslationController({ translate, onState: vi.fn() })
    controller.updateInput('hello', context)
    await vi.advanceTimersByTimeAsync(399)
    expect(translate).not.toHaveBeenCalled()
    controller.updateInput('good morning', context)
    await vi.advanceTimersByTimeAsync(400)
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate.mock.calls[0][0]).toBe('good morning')
    controller.dispose()
  })
  it('does not reissue the same phrase while pending or in flight', async () => {
    const translate = vi.fn(() => new Promise<QuickTranslationResult>(() => {}))
    const controller = createQuickTranslationController({ translate, onState: vi.fn() })
    controller.updateInput('hello world', context)
    await vi.advanceTimersByTimeAsync(200)
    controller.updateInput(' hello   world ', context)
    await vi.advanceTimersByTimeAsync(200)
    expect(translate).toHaveBeenCalledTimes(1)
    controller.updateInput('hello world', context)
    await vi.advanceTimersByTimeAsync(400)
    expect(translate).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('aborts in-flight work when input becomes ineligible and suppresses late responses', async () => {
    let resolve!: (value: QuickTranslationResult) => void
    let signal!: AbortSignal
    const states: QuickTranslationState[] = []
    const controller = createQuickTranslationController({
      translate: (_text, options) => {
        signal = options.signal
        return new Promise((done) => {
          resolve = done
        })
      },
      onState: (state) => states.push(state)
    })
    controller.updateInput('hello', context)
    await vi.advanceTimersByTimeAsync(400)
    controller.updateInput('sk-secret123', context)
    expect(signal.aborted).toBe(true)
    resolve({ text: 'old result' })
    await Promise.resolve()
    expect(states.at(-1)?.status).toBe('idle')
    expect(states.some((state) => state.text === 'old result')).toBe(false)
    controller.dispose()
  })
  it('ignores out-of-order results and reuses only successful bounded cache entries', async () => {
    const completions: Array<(value: QuickTranslationResult) => void> = []
    const states: QuickTranslationState[] = []
    const translate = vi.fn(
      () => new Promise<QuickTranslationResult>((resolve) => completions.push(resolve))
    )
    const controller = createQuickTranslationController({
      translate,
      onState: (state) => states.push(state),
      cacheSize: 1
    })
    controller.updateInput('hello', context)
    await vi.advanceTimersByTimeAsync(400)
    controller.updateInput('good morning', context)
    await vi.advanceTimersByTimeAsync(400)
    completions[1]({ text: '早上好' })
    await Promise.resolve()
    completions[0]({ text: 'old' })
    await Promise.resolve()
    expect(states.at(-1)?.text).toBe('早上好')
    controller.updateInput(' good   morning ', context)
    expect(translate).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.text).toBe('早上好')
    controller.updateInput('hello', context)
    await vi.advanceTimersByTimeAsync(400)
    completions[2]({ text: '你好' })
    await Promise.resolve()
    controller.updateInput('good morning', context)
    await vi.advanceTimersByTimeAsync(400)
    expect(translate).toHaveBeenCalledTimes(4)
    controller.dispose()
  })
  it('does not cache missing-configuration errors, and configuration changes invalidate successes', async () => {
    const translate = vi
      .fn()
      .mockResolvedValueOnce({ text: '', needsConfiguration: true })
      .mockResolvedValue({ text: '你好' })
    const states: QuickTranslationState[] = []
    const controller = createQuickTranslationController({
      translate,
      onState: (state) => states.push(state)
    })
    controller.updateInput('hello', context, { explicit: true })
    await Promise.resolve()
    expect(states.at(-1)?.status).toBe('error')
    controller.updateInput('hello', context, { explicit: true })
    await Promise.resolve()
    expect(translate).toHaveBeenCalledTimes(2)
    controller.invalidateConfiguration()
    expect(states.at(-1)?.status).toBe('idle')
    controller.updateInput('hello', context, { explicit: true })
    await Promise.resolve()
    expect(translate).toHaveBeenCalledTimes(3)
    controller.dispose()
  })
  it('cancels pending debounce on cancel/dispose and does not cache thrown errors', async () => {
    const translate = vi.fn().mockRejectedValue(new Error('timeout'))
    const onState = vi.fn()
    const controller = createQuickTranslationController({ translate, onState })
    controller.updateInput('hello', context)
    controller.cancel()
    await vi.advanceTimersByTimeAsync(400)
    expect(translate).not.toHaveBeenCalled()
    controller.updateInput('hello', context, { explicit: true })
    await Promise.resolve()
    controller.updateInput('hello', context, { explicit: true })
    await Promise.resolve()
    expect(translate).toHaveBeenCalledTimes(2)
    controller.updateInput('world', context)
    controller.dispose()
    const calls = onState.mock.calls.length
    await vi.advanceTimersByTimeAsync(400)
    expect(onState).toHaveBeenCalledTimes(calls)
    expect(translate).toHaveBeenCalledTimes(2)
  })
})
