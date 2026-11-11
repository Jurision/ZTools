import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILE_SEARCH_EXCLUDES,
  MATCH_SCORE,
  allowedTypos,
  buildEverythingQueries,
  highlightSegments,
  isExcludedPath,
  isSearchableFileQuery,
  needsDeepSearch,
  normalizeFileSearchSettings,
  normalizeFileSearchViewState,
  parseFileQuery,
  parseFileSearchInput,
  scoreFileName
} from '../../src/shared/fileSearch'

/**
 * Score a bare name in a neutral folder.
 * @param name File or folder name (no dot means folder).
 * @param query Raw query text.
 * @param fuzzy Whether fuzzy matching is allowed.
 * @returns Tier of the match, or null.
 */
function tier(name: string, query: string, fuzzy = true): number | null {
  const parsed = parseFileQuery(query)
  if (parsed.kind !== 'terms') throw new Error('expected terms')
  const score = scoreFileName(
    { name, path: 'D:\\x\\' + name, isFolder: !name.includes('.') },
    parsed.terms,
    fuzzy
  )
  return score === null ? null : Math.floor(score / 10000) * 10
}

describe('file search settings and parsing', () => {
  it('defaults on with built-in exclusions and fuzzy relevance view', () => {
    expect(normalizeFileSearchSettings()).toEqual({
      enabled: true,
      excludes: DEFAULT_FILE_SEARCH_EXCLUDES
    })
    expect(normalizeFileSearchSettings({ enabled: false, excludes: [] })).toEqual({
      enabled: false,
      excludes: []
    })
    expect(normalizeFileSearchViewState()).toEqual({ mode: 'fuzzy', types: [], sort: 'relevance' })
  })
  it('rejects oversized regex instead of truncating its validated pattern', () => {
    const boundary = 'a'.repeat(256)
    expect(parseFileQuery('re:' + boundary)).toEqual({ kind: 'regex', pattern: boundary })
    expect(parseFileQuery('re:' + 'a'.repeat(257))).toMatchObject({ kind: 'invalid' })
    // This is valid before truncation, but truncating at 256 would leave an unclosed bracket.
    expect(parseFileQuery('re:' + 'a'.repeat(255) + '[bc]')).toEqual({
      kind: 'invalid',
      message: '正则表达式不能超过 256 个字符'
    })
  })
  it('recognizes the "f keyword" prefix, words and re: patterns', () => {
    expect(parseFileSearchInput('f 家人')).toBe('家人')
    expect(parseFileSearchInput('f ')).toBe('')
    expect(parseFileSearchInput('firefox')).toBeNull()
    expect(parseFileQuery(' 家人　ＡＢＣ ')).toEqual({ kind: 'terms', terms: ['家人', 'abc'] })
    expect(parseFileQuery('re:^家人$')).toEqual({ kind: 'regex', pattern: '^家人$' })
    expect(parseFileQuery('re:(').kind).toBe('invalid')
    expect(isSearchableFileQuery('a')).toBe(false)
    expect(isSearchableFileQuery('家')).toBe(true)
  })
})

describe('match tiers', () => {
  it('orders exact, prefix, contains, then fuzzy', () => {
    expect(tier('家人', '家人')).toBe(MATCH_SCORE.exact)
    expect(tier('家人。', '家人')).toBe(MATCH_SCORE.prefix)
    expect(tier('做自己和家人的理财达人.pdf', '家人')).toBe(MATCH_SCORE.contains)
    expect(tier('家里人.jpg', '家人')).toBe(MATCH_SCORE.gap)
    expect(tier('家里人.jpg', '家人', false)).toBeNull()
    expect(tier('人家', '家人')).toBeNull()
    expect(tier('ＡＢＣ全角.txt', 'abc')).toBe(MATCH_SCORE.prefix)
  })
  it('allows wrong characters by length only', () => {
    expect(allowedTypos('家人')).toBe(0)
    expect(allowedTypos('朱元昊')).toBe(1)
    expect(tier('朱元欣简历.docx', '朱元昊')).toBe(MATCH_SCORE.typo)
    expect(tier('朱元昊简历.docx', '朱元昊')).toBe(MATCH_SCORE.prefix)
    expect(tier('家长.txt', '家人')).toBeNull()
    expect(tier('repart-notes.txt', 'report')).toBe(MATCH_SCORE.typo)
  })
  it('matches full pinyin, initials and a mix', () => {
    expect(tier('朱元欣', 'zyx')).toBe(MATCH_SCORE.pinyin)
    expect(tier('朱元欣简历.docx', 'zhuyuanxin')).toBe(MATCH_SCORE.pinyin)
    expect(tier('朱元欣简历.docx', 'zhuyx')).toBe(MATCH_SCORE.pinyin)
    expect(tier('朱元欣简历.docx', 'zyq')).toBeNull()
    expect(tier('朱元欣简历.docx', 'zyx', false)).toBeNull()
  })
  it('requires every word (AND)', () => {
    expect(tier('家人 照片 2020.zip', '家人 照片')).toBe(MATCH_SCORE.prefix)
    expect(tier('家人合影.jpg', '家人 照片')).toBeNull()
  })
})

describe('index queries, exclusions and highlighting', () => {
  const base = { mode: 'fuzzy' as const, types: [], excludes: [], limit: 5 }
  it('plans quoted tiered queries with filters', () => {
    const queries = buildEverythingQueries(parseFileQuery('家人'), {
      ...base,
      types: ['folder'],
      excludes: [':\\Windows\\']
    })
    expect(queries.map((query) => query.search)).toEqual([
      '<wfn:"家人"|wfn:"家人.*"> folder: !":\\Windows\\"',
      'startwith:"家人" folder: !":\\Windows\\"',
      '"家人" folder: !":\\Windows\\"'
    ])
    expect(buildEverythingQueries(parseFileQuery('re:^家'), base)[0].search).toBe('regex:"^家"')
  })
  it('runs the slow non-Chinese fuzzy queries only when asked', () => {
    expect(needsDeepSearch('report', 'fuzzy')).toBe(true)
    expect(needsDeepSearch('家人', 'fuzzy')).toBe(false)
    const deep = buildEverythingQueries(parseFileQuery('report'), { ...base, deep: true })
    expect(deep.find((query) => query.id === 'gap')?.search).toBe('regex:"r.?e.?p.?o.?r.?t"')
    expect(deep.some((query) => query.id === 'typo')).toBe(true)
  })
  it('hides system folders and caches by default', () => {
    const excluded = (target: string): boolean =>
      isExcludedPath(target, DEFAULT_FILE_SEARCH_EXCLUDES)
    expect(excluded('C:\\Windows\\System32\\a.dll')).toBe(true)
    expect(excluded('E:\\$RECYCLE.BIN\\S-1-5\\a.docx')).toBe(true)
    expect(excluded('D:\\code\\node_modules\\x\\index.js')).toBe(true)
    expect(excluded('E:\\备份\\惠普备份\\家人')).toBe(false)
  })
  it('marks literal hits', () => {
    expect(highlightSegments('我的Report.pdf', 'report')).toEqual([
      { text: '我的', hit: false },
      { text: 'Report', hit: true },
      { text: '.pdf', hit: false }
    ])
  })
})
