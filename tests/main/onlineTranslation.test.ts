import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  signYoudao,
  parseOpenAiTranslation,
  openAiTranslationEndpoint,
  translateOnline,
  YOUDAO_PROVIDER_ID,
  OPENAI_TRANSLATION_PROVIDER_ID
} from '../../src/main/core/provider/onlineTranslation'

const youdao = { appKey: 'fixture-app-key', appSecret: 'fixture-secret-not-real' }
const openai = {
  baseUrl: 'https://translation.example.test/v1',
  apiKey: 'fixture-api-key-not-real',
  model: 'fixture-model'
}
afterEach(() => vi.useRealTimers())

describe('online translation providers with mock transport only', () => {
  it('signs short and long Unicode text using v3 before encoding', () => {
    expect(signYoudao('hello', 'key', 'secret', 'salt', '1700000000')).toBe(
      createHash('sha256').update('keyhellosalt1700000000secret').digest('hex')
    )
    const text = '😀'.repeat(21)
    expect(signYoudao(text, 'key', 'secret', 'salt', '1')).toBe(
      createHash('sha256')
        .update('key' + '😀'.repeat(10) + '21' + '😀'.repeat(10) + 'salt1secret')
        .digest('hex')
    )
  })

  it('does not send anything when selected service needs configuration', async () => {
    const fetch = vi.fn()
    expect(await translateOnline(YOUDAO_PROVIDER_ID, {}, { text: 'hello' }, fetch)).toMatchObject({
      needsConfiguration: true
    })
    expect(
      await translateOnline(
        OPENAI_TRANSLATION_PROVIDER_ID,
        { ...openai, apiKey: '' },
        { text: 'hello' },
        fetch
      )
    ).toMatchObject({ needsConfiguration: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts a signed form, without putting input or secrets in the URL, and parses optional legacy basic fields', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errorCode: '0',
            translation: ['你好'],
            basic: { phonetic: 'fixture-phonetic', explains: ['fixture-meaning'] }
          })
        )
    )
    expect(
      await translateOnline(YOUDAO_PROVIDER_ID, youdao, { text: 'hello & goodbye' }, fetch)
    ).toEqual({ text: '你好', phonetic: 'fixture-phonetic', meanings: ['fixture-meaning'] })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openapi.youdao.com/api')
    expect(init.redirect).toBe('error')
    const form = new URLSearchParams(String(init.body))
    expect(form.get('q')).toBe('hello & goodbye')
    expect(form.get('signType')).toBe('v3')
    expect(form.get('appSecret')).toBeNull()
    expect(form.get('sign')).toBe(
      signYoudao(
        'hello & goodbye',
        youdao.appKey,
        youdao.appSecret,
        form.get('salt')!,
        form.get('curtime')!
      )
    )
  })

  it('accepts current standard Youdao responses without dictionary fields', async () => {
    const result = await translateOnline(
      YOUDAO_PROVIDER_ID,
      youdao,
      { text: 'hello' },
      async () => new Response(JSON.stringify({ errorCode: '0', translation: ['你好'] }))
    )
    expect(result.text).toBe('你好')
    expect(result.meanings).toBeUndefined()
  })

  it('uses the configured Chat Completions model and parses its message', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] }))
    )
    expect(
      await translateOnline(OPENAI_TRANSLATION_PROVIDER_ID, openai, { text: 'hello' }, fetch)
    ).toEqual({ text: '你好' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://translation.example.test/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'fixture-model',
      stream: false,
      messages: [{ role: 'system' }, { role: 'user', content: 'hello' }]
    })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-api-key-not-real' })
  })

  it('translates Chinese into English in both protocols and requests word details only for English words', async () => {
    const fetchYoudao = vi.fn(
      async () => new Response(JSON.stringify({ errorCode: '0', translation: ['hello'] }))
    )
    await translateOnline(YOUDAO_PROVIDER_ID, youdao, { text: '你好' }, fetchYoudao)
    const form = new URLSearchParams(
      String((fetchYoudao.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    )
    expect(form.get('to')).toBe('en')
    expect(form.get('strict')).toBe('true')
    const fetchModel = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }))
    )
    await translateOnline(OPENAI_TRANSLATION_PROVIDER_ID, openai, { text: '你好' }, fetchModel)
    const body = JSON.parse(
      String((fetchModel.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    )
    expect(body.messages[0].content).toContain('into English')
    await translateOnline(OPENAI_TRANSLATION_PROVIDER_ID, openai, { text: 'apple' }, fetchModel)
    const wordBody = JSON.parse(
      String((fetchModel.mock.calls[1] as unknown as [string, RequestInit])[1].body)
    )
    expect(wordBody.messages[0].content).toContain('phonetic')
    expect(wordBody.response_format).toBeUndefined()
  })

  it('parses fenced word JSON defensively and preserves plain text fallback', () => {
    expect(
      parseOpenAiTranslation(
        '```json\n{"text":"苹果","phonetic":"fixture-ipa","meanings":["n. 苹果",42]}\n```'
      )
    ).toEqual({ text: '苹果', phonetic: 'fixture-ipa', meanings: ['n. 苹果'] })
    expect(parseOpenAiTranslation('苹果')).toEqual({ text: '苹果' })
    expect(parseOpenAiTranslation('{broken')).toEqual({ text: '{broken' })
  })

  it('normalizes safe endpoints and rejects URL credentials, queries and remote plaintext', () => {
    expect(openAiTranslationEndpoint('https://translation.example.test')).toBe(
      'https://translation.example.test/v1/chat/completions'
    )
    expect(openAiTranslationEndpoint('http://localhost:11434/v1')).toBe(
      'http://localhost:11434/v1/chat/completions'
    )
    expect(openAiTranslationEndpoint('https://translation.example.test/v1/chat/completions')).toBe(
      'https://translation.example.test/v1/chat/completions'
    )
    for (const url of [
      'http://remote.example.test/v1',
      'https://user:secret@example.test',
      'https://example.test?key=secret',
      'file:///private'
    ])
      expect(openAiTranslationEndpoint(url)).toBeNull()
  })

  it('times out a stalled response body after five seconds and aborts transport', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null = null
    const pending = translateOnline(
      YOUDAO_PROVIDER_ID,
      youdao,
      { text: 'hello' },
      async (_url, init) => {
        signal = init.signal as AbortSignal
        return { ok: true, json: () => new Promise(() => {}) } as unknown as Response
      }
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({ text: '', error: '翻译超时，请重试。' })
    expect(signal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels in-flight requests and sanitizes thrown errors and HTTP error bodies', async () => {
    const controller = new AbortController()
    const pending = translateOnline(
      YOUDAO_PROVIDER_ID,
      youdao,
      { text: 'hello' },
      () => new Promise(() => {}),
      controller.signal
    )
    controller.abort()
    expect(await pending).toEqual({ text: '', error: '翻译已取消。' })
    const failed = await translateOnline(
      YOUDAO_PROVIDER_ID,
      youdao,
      { text: 'private input fixture' },
      async () => {
        throw new Error('fixture-secret private input fixture')
      }
    )
    expect(JSON.stringify(failed)).not.toMatch(/fixture|private/)
    const denied = await translateOnline(
      OPENAI_TRANSLATION_PROVIDER_ID,
      openai,
      { text: 'hello' },
      async () => new Response('fixture-api-key-not-real', { status: 401 })
    )
    expect(denied.error).toBe('翻译服务鉴权失败，请检查配置。')
  })
})
