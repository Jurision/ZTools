import { describe, expect, it } from 'vitest'
import {
  allowPluginSearch,
  isSearchCommandVisible,
  isTranslationShortcut,
  normalizeSearchSources,
  parseSearchScope
} from '../../src/shared/searchSources'

const app = { name: 'Chrome', path: 'C:\\Chrome.exe', type: 'direct', subType: 'app' }

describe('default main-search scope', () => {
  it('treats absent/legacy preferences as application-only without mutating persisted input', () => {
    const legacy = { plugins: 'true', files: 1 }
    expect(normalizeSearchSources(legacy)).toMatchObject({
      plugins: false,
      files: false,
      systemSettings: false
    })
    expect(legacy).toEqual({ plugins: 'true', files: 1 })
  })

  it('filters mixed ba results without deleting registry entries', () => {
    const commands = [
      { ...app, name: 'Git Bash' },
      { ...app, name: 'Global Flags (X64)' },
      { ...app, name: 'Global Flags (ARM)' },
      { ...app, name: '获取帮助' },
      { ...app, name: '豆包' },
      { name: '备忘记录', path: '/plugins/memo', type: 'plugin' },
      { name: '屏幕', path: 'ms-settings:display', type: 'direct', subType: 'system-setting' },
      { ...app, name: '最新版本的更新', path: 'C:\\update.lnk', targetPath: 'C:\\update.txt' }
    ]
    const config = normalizeSearchSources()
    expect(
      commands.filter((command) => isSearchCommandVisible(command, config)).map((c) => c.name)
    ).toEqual(['Git Bash', '豆包'])
    expect(commands).toHaveLength(8)
    expect(commands.every((command) => isSearchCommandVisible(command, config, true))).toBe(true)
  })

  it('keeps disabled source switches separate and supports restoring default-hidden apps', () => {
    const config = normalizeSearchSources({ files: true, hiddenApplicationNames: [] })
    expect(isSearchCommandVisible({ ...app, name: 'Global Flags (X64)' }, config)).toBe(true)
    expect(isSearchCommandVisible({ ...app, path: 'C:\\invoice.pdf' }, config)).toBe(true)
    expect(isSearchCommandVisible({ ...app, path: 'ms-settings:display' }, config)).toBe(false)
    expect(isSearchCommandVisible({ ...app, type: 'plugin' }, config)).toBe(false)
  })

  it('classifies resolved folders, uncommon files and control panels independently', () => {
    for (const targetPath of ['C:/Docs/Budget', 'C:/manual.chm', 'C:/data.json']) {
      const entry = { ...app, path: 'C:/Shortcut.lnk', targetPath }
      expect(isSearchCommandVisible(entry, normalizeSearchSources())).toBe(false)
      expect(isSearchCommandVisible(entry, normalizeSearchSources({ files: true }))).toBe(true)
    }
    for (const targetPath of ['C:/Windows/services.msc', 'C:/Windows/appwiz.cpl']) {
      const entry = { ...app, path: 'C:/Shortcut.lnk', targetPath }
      expect(isSearchCommandVisible(entry, normalizeSearchSources({ files: true }))).toBe(false)
      expect(isSearchCommandVisible(entry, normalizeSearchSources({ systemSettings: true }))).toBe(
        true
      )
    }
    for (const targetPath of ['C:/App.exe', 'steam://rungameid/12345', 'uwp:Publisher.App']) {
      expect(isSearchCommandVisible({ ...app, targetPath }, normalizeSearchSources())).toBe(true)
    }
  })

  it('hides aliases of excluded applications using the original application name', () => {
    expect(
      isSearchCommandVisible(
        { ...app, name: '调试工具', originalName: 'Global Flags (X86)' },
        normalizeSearchSources()
      )
    ).toBe(false)
  })

  it('requires explicit command scope before invoking plugin providers by default', () => {
    expect(parseSearchScope(' > 计算稿纸 ')).toEqual({ query: '计算稿纸', explicit: true })
    expect(parseSearchScope('ba')).toEqual({ query: 'ba', explicit: false })
    expect(allowPluginSearch('hello', normalizeSearchSources())).toBe(false)
    expect(allowPluginSearch('> hello', normalizeSearchSources())).toBe(true)
    expect(allowPluginSearch('hello', normalizeSearchSources({ plugins: true }))).toBe(true)
  })

  it('does not conflate unknown shortcuts with applications', () => {
    const shortcut = { ...app, subType: 'local-shortcut' }
    expect(
      isSearchCommandVisible({ ...shortcut, path: 'C:\\Work' }, normalizeSearchSources())
    ).toBe(false)
    expect(isSearchCommandVisible(shortcut, normalizeSearchSources())).toBe(true)
  })
})

describe('local explicit translation chord', () => {
  it('recognizes Ctrl/Cmd+Shift+T but excludes repeat, IME and unrelated chords', () => {
    const event = { key: 'T', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
    expect(isTranslationShortcut(event)).toBe(true)
    expect(isTranslationShortcut({ ...event, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isTranslationShortcut({ ...event, isComposing: true })).toBe(false)
    expect(isTranslationShortcut({ ...event, repeat: true })).toBe(false)
    expect(isTranslationShortcut({ ...event, shiftKey: false })).toBe(false)
    expect(isTranslationShortcut({ ...event, altKey: true })).toBe(false)
    expect(isTranslationShortcut({ ...event, key: 'Enter' })).toBe(false)
  })
})
