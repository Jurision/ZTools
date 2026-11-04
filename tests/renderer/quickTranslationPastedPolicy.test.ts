import { describe, expect, it } from 'vitest'
import { evaluateQuickTranslation } from '../../src/shared/quickTranslationPolicy'

const pasted = (text: string, hasAppMatches = false) =>
  evaluateQuickTranslation(text, { hasAppMatches }, { pasted: true })

describe('deliberately pasted text translation policy', () => {
  it.each([
    '数学七大猜想之一 哥德巴赫猜想，于 1742 年提出：任一大于 2 的偶数都可写成两个质数之和。',
    'The conjecture was proposed in 1742 by Christian Goldbach.',
    'Note: this applies to macOS and Windows 11.',
    'serendipity',
    '微信',
    '你好'
  ])('translates pasted prose, including digits and punctuation: %s', (text) => {
    expect(pasted(text).eligible).toBe(true)
  })

  it('ignores application-name rules for pasted text', () => {
    expect(pasted('Chrome', true).eligible).toBe(true)
    expect(pasted('网易', true).eligible).toBe(true)
  })

  it.each([
    ['https://example.com/page', 'address-or-path'],
    ['联系 user@example.com 获取资料', 'address-or-path'],
    ['C:\\Users\\mx-ui\\file.txt', 'address-or-path'],
    ['example.com', 'address-or-path'],
    ['我的密码是 hello world', 'sensitive-text'],
    ['api key here', 'sensitive-text'],
    ['sk-abc123def456', 'sensitive-text'],
    ['login with a1b2c3d4e5 please', 'sensitive-text'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'sensitive-text'],
    ['12345 678', 'non-natural-text'],
    ['!!! ???', 'non-natural-text']
  ])('blocks %s (%s)', (text, reason) => {
    expect(pasted(text).reason).toBe(reason)
  })

  it('caps automatic pasted translation at 2000 characters', () => {
    expect(pasted('字'.repeat(2000)).eligible).toBe(true)
    expect(pasted('字'.repeat(2001)).reason).toBe('too-long')
  })

  it('typed input keeps the stricter rules', () => {
    expect(evaluateQuickTranslation('于 1742 年提出', { hasAppMatches: false }).eligible).toBe(
      false
    )
  })
})
