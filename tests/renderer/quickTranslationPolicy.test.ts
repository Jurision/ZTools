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
  it.each([
    '我刚才买了 Packers 的邮箱，但是它似乎没有出现在我的列表里。我设置密码的时候，它显示我 miss domain ID',
    '密码',
    'How do I reset my password?',
    'The API key setting is missing and authorization failed.',
    '我没有收到验证码，应该如何重新设置密码？',
    '设置密码时显示 missing domain ID，请帮我确认邮箱是否创建成功。',
    '那我如果买这两个域名邮箱都是24个月，总共的费用是多少',
    '购买２４个月，总价是￥128.50，折扣为20%。',
    'If I buy both email plans for 24 months, what is the total cost?',
    '费用说明：第一年 100 元；第二年 120 元。',
    '第一段有24个月。\n第二段有2个邮箱。',
    '这是一段较长的费用说明。'.repeat(40),
    'a'
  ])('accepts explicit prose with numbers, punctuation and longer paragraphs: %s', (text) => {
    expect(evaluateQuickTranslation(text, noApps, { explicit: true }).eligible).toBe(true)
  })

  it('uses the 10000-character IPC limit without relaxing automatic typed translation', () => {
    expect(evaluateQuickTranslation('字'.repeat(10000), noApps, { explicit: true }).eligible).toBe(
      true
    )
    expect(evaluateQuickTranslation('字'.repeat(10001), noApps, { explicit: true }).reason).toBe(
      'too-long'
    )
    expect(evaluateQuickTranslation('购买24个月', noApps).eligible).toBe(false)
    expect(evaluateQuickTranslation('字'.repeat(257), noApps).reason).toBe('too-long')
  })

  it.each([
    'D:\\folder\\file.txt',
    'folder\\file.txt',
    '/home/user',
    '联系 user@example.com 获取报价',
    'https://example.com',
    '我的密码是 hello',
    'sk-abc123',
    'mySecretToken',
    '中文夹着a1b2c3d4e5也不能发送',
    'abcdefghijklmnopqrstuvwxyz',
    '200000*1.5',
    '12345',
    '!!!'
  ])('does not apply automatic content heuristics to deliberate translation: %s', (text) => {
    expect(evaluateQuickTranslation(text, noApps, { explicit: true }).eligible).toBe(true)
  })

  it('preserves internal whitespace and line breaks for explicit translation, including pasted blocks', () => {
    const text = '第一行：设置密码失败。\n\nError:  missing domain ID'
    for (const pasted of [false, true]) {
      expect(evaluateQuickTranslation(`  ${text}  `, noApps, { explicit: true, pasted })).toEqual({
        eligible: true,
        reason: 'eligible',
        normalizedText: text
      })
    }
    expect(evaluateQuickTranslation('  \n  ', noApps, { explicit: true }).reason).toBe('empty')
  })

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
    for (const input of ['网易', '网易云', '腾讯会议'])
      expect(evaluateQuickTranslation(input, { hasAppMatches: true }).reason).toBe('app-match')
    expect(evaluateQuickTranslation('网易', noApps).eligible).toBe(true)
    expect(evaluateQuickTranslation('今天天气不错', { hasAppMatches: true }).eligible).toBe(true)
    expect(
      evaluateQuickTranslation('腾讯会议', { hasAppMatches: true }, { explicit: true }).eligible
    ).toBe(true)
    expect(
      evaluateQuickTranslation('你好世界', { hasAppMatches: true, appNames: ['你好世界'] }).reason
    ).toBe('app-match')
    expect(
      evaluateQuickTranslation('Custom App', { ...noApps, appNames: ['custom app'] }).reason
    ).toBe('app-match')
  })
  it('explicit requests bypass all automatic search heuristics', () => {
    for (const input of ['Chrome', 'API', 'hi', 'password reset', 'https://example.com'])
      expect(
        evaluateQuickTranslation(input, { hasAppMatches: true }, { explicit: true }).eligible
      ).toBe(true)
  })
})
