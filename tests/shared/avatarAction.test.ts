import { describe, expect, it } from 'vitest'
import { resolveAvatarAction } from '../../src/shared/avatarAction'

describe('explicit avatar AI action', () => {
  it('opens settings for empty or whitespace input', () => {
    expect(resolveAvatarAction('search', '')).toEqual({ type: 'settings' })
    expect(resolveAvatarAction('search', '  \n ')).toEqual({ type: 'settings' })
  })
  it('submits Chinese, English, formulas and long text only on explicit click', () => {
    for (const text of ['你好', 'Telegram', '1+2', '测试'.repeat(1000)]) {
      expect(resolveAvatarAction('search', text)).toEqual({ type: 'ai', text })
    }
  })
  it('includes a pasted text block and a typed question without losing either', () => {
    expect(resolveAvatarAction('search', '总结一下', '原文')).toEqual({
      type: 'ai',
      text: '原文\n\n总结一下'
    })
  })
  it('preserves plugin menus and does not submit unfinished IME input', () => {
    expect(resolveAvatarAction('plugin', '输入')).toEqual({ type: 'plugin-menu' })
    expect(resolveAvatarAction('search', 'ni', null, true)).toEqual({ type: 'none' })
  })
})
