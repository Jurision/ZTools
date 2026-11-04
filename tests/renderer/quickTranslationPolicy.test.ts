import { describe, expect, it } from 'vitest'
import { evaluateQuickTranslation } from '../../src/shared/quickTranslationPolicy'
const noApps = { hasAppMatches: false }
export const translationPolicyExamples = {
  send: [
    '你好',
    '今天的天气很好',
    'hello world',
    'good morning',
    'hello',
    'translate',
    'How are you?',
    "What's your name?"
  ],
  noSend: {
    apps: ['Chrome', 'uTools', '微信', 'Visual Studio Code', 'git'],
    abbreviations: ['API', 'NASA', 'CPU', 'AI'],
    expressions: ['1+2', '10 / 2', 'sqrt(9)', '100'],
    addresses: [
      'https://example.com',
      'user@example.com',
      'C:\\Users\\file',
      '/home/user',
      'example.com'
    ],
    credentials: [
      'sk-abc123',
      'password hello',
      'mySecretToken',
      'abcdefghijklmnopqrstuvwxyz',
      '验证码',
      'abc123!'
    ],
    other: ['', 'ab', '> 翻译']
  }
}
describe('quick translation disclosure policy', () => {
  it.each(translationPolicyExamples.send)('permits natural text %s', (input) => {
    expect(evaluateQuickTranslation(input, noApps).eligible).toBe(true)
  })
  for (const [category, inputs] of Object.entries(translationPolicyExamples.noSend)) {
    it.each(inputs)(`blocks ${category}: %s`, (input) => {
      expect(evaluateQuickTranslation(input, noApps).eligible).toBe(false)
    })
  }
  it('uses fuzzy app matches only for single English words; exact names always block', () => {
    expect(evaluateQuickTranslation('hello', { hasAppMatches: true }).eligible).toBe(false)
    expect(evaluateQuickTranslation('hello world', { hasAppMatches: true }).eligible).toBe(true)
    expect(evaluateQuickTranslation('你好世界', { hasAppMatches: true }).eligible).toBe(true)
    expect(
      evaluateQuickTranslation('你好世界', { hasAppMatches: true, appNames: ['你好世界'] }).reason
    ).toBe('app-match')
    expect(
      evaluateQuickTranslation('Custom App', { ...noApps, appNames: ['custom app'] }).reason
    ).toBe('app-match')
  })
  it('explicit requests bypass software and abbreviation rules but not sensitive input guards', () => {
    for (const input of ['Chrome', 'API', 'hi'])
      expect(
        evaluateQuickTranslation(input, { hasAppMatches: true }, { explicit: true }).eligible
      ).toBe(true)
    for (const input of ['password hello', 'sk-abc123', 'https://example.com'])
      expect(evaluateQuickTranslation(input, noApps, { explicit: true }).eligible).toBe(false)
  })
})
