import { describe, it, expect } from 'vitest'
import { deduplicateResults } from '../../src/renderer/src/composables/useSearchResults'

describe('deduplicateResults', () => {
  it('uses verified launch identities across scanned and manual sources without merging profiles', () => {
    const shortcut = {
      name: 'Nebula',
      path: 'C:/Start/Nebula.lnk',
      targetPath: 'C:/Apps/Nebula.exe',
      launchSignature: 'default',
      type: 'app'
    }
    const results = [
      shortcut,
      { name: 'Nebula', path: 'c:\\apps\\nebula.exe', type: 'local-shortcut' },
      { ...shortcut, path: 'C:/Start/Profile.lnk', launchSignature: 'profile-digest' },
      { ...shortcut, name: 'Work shortcut' }
    ]
    expect(deduplicateResults(results)).toEqual([shortcut, results[2], results[3]])
  })
  describe('非插件类型', () => {
    it('应去除同名同路径的重复项', () => {
      const results = [
        { name: 'Chrome', path: 'C:\\chrome.exe', type: 'app' },
        { name: 'Chrome', path: 'C:\\chrome.exe', type: 'app' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(1)
    })

    it('应保留不同名同路径的应用（核心特性）', () => {
      const results = [
        { name: '原神', path: 'C:\\launcher.exe', type: 'app' },
        { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'app' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(2)
    })

    it('应保留同名不同路径的应用', () => {
      const results = [
        { name: 'App', path: 'C:\\v1\\app.exe', type: 'app' },
        { name: 'App', path: 'C:\\v2\\app.exe', type: 'app' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(2)
    })
  })

  describe('插件类型', () => {
    it('应用 path+featureCode 去重', () => {
      const results = [
        { name: '翻译', path: '/plugins/translate', type: 'plugin', featureCode: 'translate' },
        { name: '翻译', path: '/plugins/translate', type: 'plugin', featureCode: 'translate' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(1)
    })

    it('应保留同路径不同 featureCode 的插件', () => {
      const results = [
        { name: '翻译', path: '/plugins/translate', type: 'plugin', featureCode: 'translate' },
        { name: '词典', path: '/plugins/translate', type: 'plugin', featureCode: 'dict' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(2)
    })
  })

  describe('混合类型', () => {
    it('应同时处理插件和非插件', () => {
      const results = [
        { name: 'Chrome', path: 'C:\\chrome.exe', type: 'app' },
        { name: 'Chrome', path: 'C:\\chrome.exe', type: 'app' },
        { name: '翻译', path: '/plugins/translate', type: 'plugin', featureCode: 'translate' },
        { name: '翻译', path: '/plugins/translate', type: 'plugin', featureCode: 'translate' },
        { name: '原神', path: 'C:\\launcher.exe', type: 'app' },
        { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'app' }
      ]
      const deduped = deduplicateResults(results)
      expect(deduped).toHaveLength(4) // Chrome + 翻译 + 原神 + 米哈游启动器
    })
  })

  it('空数组应返回空数组', () => {
    expect(deduplicateResults([])).toEqual([])
  })

  it('应保留第一个出现的重复项', () => {
    const results = [
      { name: 'App', path: 'C:\\app.exe', type: 'app', extra: 'first' },
      { name: 'App', path: 'C:\\app.exe', type: 'app', extra: 'second' }
    ]
    const deduped = deduplicateResults(results)
    expect(deduped[0].extra).toBe('first')
  })
})
