import { pinyin } from 'pinyin-pro'
import { normalizeHiddenPaths } from './searchHiddenPaths'

export type FileSearchMode = 'fuzzy' | 'exact'
export type FileSearchSort = 'relevance' | 'recent' | 'name' | 'size' | 'type'
export type FileSearchHistory = Record<string, { count: number; lastOpened: number }>
export type FileTypeFilter =
  | 'folder'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'program'

export interface FileSearchSettings {
  hiddenPaths?: string[]
  /** Show disk file results in the main search box. */
  enabled: boolean
  /** Case-insensitive path fragments; any item whose full path contains one is hidden. */
  excludes: string[]
}

export interface FileSearchViewState {
  mode: FileSearchMode
  types: FileTypeFilter[]
  sort: FileSearchSort
  direction?: 'asc' | 'desc'
}

export interface FileSearchRequest extends FileSearchViewState {
  hiddenPaths?: string[]
  query: string
  phase?: 'literal' | 'fuzzy'
  directPath?: string
  history?: FileSearchHistory
  unavailableRoots?: string[]
  /** Maximum number of items returned to the caller. */
  limit: number
  /** Also run the slower typo/insertion search for non-Chinese words (dedicated page only). */
  deep?: boolean
  excludes: string[]
  /** Requests on the same channel supersede each other. */
  channel?: string
}

export interface FileSearchItem {
  /** Full path including the name. */
  path: string
  name: string
  /** Parent folder path. */
  dir: string
  isFolder: boolean
  size?: number
  /** Last modification time in milliseconds since the Unix epoch. */
  modified?: number
  /** Lower is better; see MATCH_SCORE. */
  score: number
}

export interface FileSearchResponse {
  status: 'ok' | 'unavailable' | 'invalid' | 'cancelled'
  items: FileSearchItem[]
  /** Number of literal matches known to the index (fuzzy-only matches are not counted). */
  total: number
  message?: string
}

export type ParsedFileQuery =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'regex'; pattern: string }
  | { kind: 'terms'; terms: string[] }

export interface EverythingQuery {
  id: 'exact' | 'prefix' | 'contains' | 'gap' | 'typo' | 'regex'
  search: string
  count: number
  /** Ask the index for the most recently modified items first. */
  recentFirst: boolean
}

export const FILE_TYPE_FILTERS: { id: FileTypeFilter; label: string; extensions: string[] }[] = [
  { id: 'folder', label: '文件夹', extensions: [] },
  {
    id: 'document',
    label: '文档',
    extensions: [
      ...['doc', 'docx', 'wps', 'rtf', 'xls', 'xlsx', 'xlsm', 'csv', 'et'],
      ...['ppt', 'pptx', 'pps', 'ppsx', 'dps', 'pdf', 'txt', 'md']
    ]
  },
  {
    id: 'image',
    label: '图片',
    extensions: [
      ...['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif', 'tif', 'tiff'],
      ...['svg', 'ico', 'psd', 'raw']
    ]
  },
  {
    id: 'video',
    label: '视频',
    extensions: [
      ...['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'],
      ...['rmvb', 'ts', '3gp']
    ]
  },
  {
    id: 'audio',
    label: '音频',
    extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'ape', 'amr', 'opus']
  },
  {
    id: 'archive',
    label: '压缩包',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'cab']
  },
  {
    id: 'program',
    label: '程序',
    extensions: ['exe', 'msi', 'bat', 'cmd', 'com', 'lnk', 'ps1', 'appx', 'msix']
  }
]

/** System folders, software data/caches and the recycle bin; editable in settings. */
export const DEFAULT_FILE_SEARCH_EXCLUDES = [
  ':\\Windows\\',
  ':\\ProgramData\\',
  ':\\$Recycle.Bin\\',
  ':\\System Volume Information\\',
  ':\\Recovery\\',
  ':\\Program Files\\WindowsApps\\',
  '\\AppData\\',
  '\\node_modules\\',
  '\\.git\\',
  '\\__pycache__\\',
  '\\.cache\\',
  '\\Cache\\',
  '\\Code Cache\\',
  '\\GPUCache\\'
]

/** Lower is better. Literal matches always sort before pinyin, insertion and typo matches. */
export const MATCH_SCORE = {
  exact: 0,
  prefix: 10,
  contains: 20,
  pinyin: 30,
  gap: 40,
  typo: 50
} as const

const HAN = /[㐀-鿿]/
const MAX_TERMS = 8
const MAX_TERM_LENGTH = 64
const TYPE_IDS = FILE_TYPE_FILTERS.map((filter) => filter.id)

/**
 * Validate persisted file-search preferences; missing values enable the feature with defaults.
 * @param value Optional persisted preferences.
 * @returns A fresh settings object; an explicitly empty exclude list is preserved.
 */
export function normalizeFileSearchSettings(value?: unknown): FileSearchSettings {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<FileSearchSettings>
  return {
    enabled: data.enabled !== false,
    hiddenPaths: normalizeHiddenPaths(data.hiddenPaths),
    excludes: Array.isArray(data.excludes)
      ? [
          ...new Set(
            data.excludes
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.replace(/"/g, '').trim().slice(0, 260))
              .filter(Boolean)
          )
        ].slice(0, 100)
      : [...DEFAULT_FILE_SEARCH_EXCLUDES]
  }
}

/**
 * Validate the dedicated page's toolbar choices.
 * @param value Optional remembered choices.
 * @returns Fuzzy matching, no type filter and relevance order unless explicitly chosen otherwise.
 */
export function normalizeFileSearchViewState(value?: unknown): FileSearchViewState {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<FileSearchViewState>
  return {
    mode: data.mode === 'exact' ? 'exact' : 'fuzzy',
    types: Array.isArray(data.types)
      ? TYPE_IDS.filter((id) => (data.types as unknown[]).includes(id))
      : [],
    sort: ['recent', 'name', 'size', 'type'].includes(data.sort || '') ? data.sort! : 'relevance',
    direction:
      data.direction === 'desc' || (data.direction !== 'asc' && data.sort === 'recent')
        ? 'desc'
        : 'asc'
  }
}

/**
 * Unify case and full-width/half-width forms so "ＡＢＣ", "abc" and "ABC" compare equal.
 * @param text Raw file name or query text.
 * @returns Comparable text.
 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/**
 * Recognize the dedicated file-search prefix "f keyword" in the main search box.
 * @param input Raw search box text.
 * @returns The file query (possibly empty) when the prefix is present, otherwise null.
 */
export function parseFileSearchInput(input: string): string | null {
  const match = /^\s*[fFｆＦ][ \u3000](.*)$/s.exec(input)
  return match ? match[1].trim() : null
}

/**
 * Recognize single-line Windows paths and path fragments while excluding web addresses and prose.
 * @param text Clipboard text.
 * @returns Unquoted path text or null for ordinary text.
 */
export function pastedFilePath(text: string): string | null {
  if (/[\r\n]/.test(text) || parseFileSearchInput(text) !== null) return null
  const value = text.trim().replace(/^"(.*)"$/, '$1')
  if (!value || value.includes('"') || /^[a-z]+:\/\//i.test(value)) return null
  return /^(?:[a-z]:[\\/]|\\\\[^\\]+\\)/i.test(value) || /[^\s\\]+\\[^\\]+/.test(value)
    ? value
    : null
}

/**
 * Select file-search scope for pasted paths or explicit path queries without rewriting user text.
 * @param text Clipboard text; multiline prose must keep its existing paste behavior.
 * @returns Unmodified entry text, or null for ordinary text.
 */
export function pastedFileSearchInput(text: string): { text: string } | null {
  if (/[\r\n]/.test(text)) return null
  const legacy = parseFileSearchInput(text)
  if (legacy !== null) return { text: legacy }
  if (pastedFilePath(text)) return { text }
  const parsed = parseFileQuery(text)
  if (
    text.trim().startsWith('"') &&
    parsed.kind === 'terms' &&
    parsed.terms.length &&
    pastedFilePath(parsed.terms[0])
  )
    return { text }
  return null
}

/**
 * Recognize a possible absolute Windows/UNC path, including spaces; the main process verifies existence.
 * @param query Raw file-search query.
 * @returns Absolute candidate or undefined.
 */
export function directFilePath(query: string): string | undefined {
  const raw = query.trim()
  const value = raw.replace(/^"(.*)"$/, '$1')
  return !/[\r\n"]/.test(value) && /^(?:[a-z]:[\\/]|\\\\[^\\]+\\)/i.test(value) ? value : undefined
}

/**
 * Split a file query into AND-ed words, or recognize an explicit "re:" regular expression.
 * @param query File query without the "f " prefix.
 * @returns Parsed words, a regex pattern, or why nothing can be searched.
 */
export function parseFileQuery(query: string): ParsedFileQuery {
  const text = query.trim()
  if (!text) return { kind: 'empty' }
  const regex = /^re[:：](.*)$/is.exec(text)
  if (regex) {
    // Quotes delimit the pattern inside the index query, so they cannot be part of it.
    const pattern = regex[1].trim().replace(/"/g, '')
    if (!pattern) return { kind: 'empty' }
    // Reject rather than truncate: cutting a validated regex can change its meaning or break it.
    if (pattern.length > 256) return { kind: 'invalid', message: '正则表达式不能超过 256 个字符' }
    try {
      new RegExp(pattern)
    } catch {
      return { kind: 'invalid', message: '正则表达式写法有误' }
    }
    return { kind: 'regex', pattern }
  }
  const terms = [...normalizeSearchText(text).matchAll(/"([^"]+)"|([^\s"]+)/g)]
    .map((match) => match[1] || match[2])
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
  return terms.length ? { kind: 'terms', terms } : { kind: 'empty' }
}

/**
 * Decide whether typed text is specific enough to query the disk index from the main search box.
 * @param query Raw search text.
 * @returns True for a regex, any Chinese character, or at least two other characters.
 */
export function isSearchableFileQuery(query: string): boolean {
  const parsed = parseFileQuery(query)
  if (parsed.kind === 'regex') return true
  if (parsed.kind !== 'terms') return false
  const joined = parsed.terms.join('')
  return HAN.test(joined) || [...joined].length >= 2
}

/**
 * Tell path-like words apart: they are matched against the whole path instead of the name.
 * @param term Normalized query word.
 * @returns Whether the word contains a path separator or drive colon.
 */
function isPathTerm(term: string): boolean {
  return /[\\/:]/.test(term)
}

/**
 * Convert printable ASCII to its full-width form to also find names typed with a Chinese IME.
 * @param text Half-width text.
 * @returns Text with ASCII characters replaced by full-width equivalents.
 */
function toFullWidth(text: string): string {
  return text.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0))
}

/**
 * Build the index expression for one literal word. Quotes make index operators literal.
 * @param term Normalized query word without quotes.
 * @returns An expression matching the word in half-width or full-width form.
 */
function literalTermExpression(term: string): string {
  if (isPathTerm(term) || !/[a-z0-9]/.test(term)) return `"${term}"`
  return `<"${term}"|"${toFullWidth(term)}">`
}

/**
 * Build the index filter for the selected types; several types are OR-ed.
 * @param types Selected type filters.
 * @returns Filter expression, or an empty string when nothing is selected.
 */
export function typeFilterExpression(types: FileTypeFilter[]): string {
  const extensions = FILE_TYPE_FILTERS.filter(
    (filter) => filter.id !== 'folder' && types.includes(filter.id)
  ).flatMap((filter) => filter.extensions)
  const parts = [
    ...(types.includes('folder') ? ['folder:'] : []),
    ...(extensions.length ? ['ext:' + extensions.join(';')] : [])
  ]
  return parts.length > 1 ? `<${parts.join('|')}>` : parts[0] || ''
}

/**
 * Build the index filter hiding excluded folders.
 * @param excludes Path fragments to hide.
 * @returns Negated path terms.
 */
export function excludeExpression(excludes: string[]): string {
  return excludes
    .map((entry) => entry.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((entry) => `!"${entry}"`)
    .join(' ')
}

/**
 * Whether a non-Chinese word is long and plain enough for the slower typo/insertion search.
 * @param term Normalized query word.
 * @returns True for 4–16 character words without Chinese characters or path separators.
 */
function isDeepFuzzyTerm(term: string): boolean {
  const length = [...term].length
  return !HAN.test(term) && !isPathTerm(term) && length >= 4 && length <= 16
}

/**
 * Escape one character for use inside a regular expression.
 * @param ch Single character.
 * @returns Escaped character.
 */
function escapeRegex(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? '\\' + ch : ch
}

/**
 * Plan the index queries for one request. Several small tiered queries keep the best matches even
 * when a word has far more hits than the result limit.
 * @param parsed Parsed query.
 * @param request Mode, filters and limits.
 * @returns Queries to run; empty when there is nothing to search.
 */
export function buildEverythingQueries(
  parsed: ParsedFileQuery,
  request: Pick<FileSearchRequest, 'mode' | 'types' | 'excludes' | 'limit' | 'deep'>
): EverythingQuery[] {
  const filters = [typeFilterExpression(request.types), excludeExpression(request.excludes)]
    .filter(Boolean)
    .join(' ')
  const count = Math.min(Math.max(request.limit * 3, 30), 400)
  const withFilters = (search: string): string => (filters ? `${search} ${filters}` : search)
  if (parsed.kind === 'regex') {
    return [
      {
        id: 'regex',
        search: withFilters(`regex:"${parsed.pattern}"`),
        count,
        recentFirst: true
      }
    ]
  }
  if (parsed.kind !== 'terms') return []
  const [first, ...rest] = parsed.terms
  const restExpression = rest.map(literalTermExpression).join(' ')
  const queries: EverythingQuery[] = []
  // Whole-name and prefix tiers only make sense for a name word, not a path fragment.
  if (!isPathTerm(first)) {
    if (!rest.length)
      queries.push({
        id: 'exact',
        search: withFilters(`<wfn:"${first}"|wfn:"${first}.*">`),
        count,
        recentFirst: true
      })
    queries.push({
      id: 'prefix',
      search: withFilters([`startwith:"${first}"`, restExpression].filter(Boolean).join(' ')),
      count,
      recentFirst: true
    })
  }
  queries.push({
    id: 'contains',
    search: withFilters(parsed.terms.map(literalTermExpression).join(' ')),
    count,
    recentFirst: true
  })
  if (request.mode === 'fuzzy' && request.deep) {
    // Chinese names come from the in-memory name index; only non-Chinese words need the index here.
    const index = parsed.terms.findIndex(isDeepFuzzyTerm)
    if (index >= 0) {
      const chars = [...parsed.terms[index]]
      const others = parsed.terms
        .filter((_, i) => i !== index)
        .map(literalTermExpression)
        .join(' ')
      queries.push({
        id: 'gap',
        search: withFilters(
          [`regex:"${chars.map(escapeRegex).join('.?')}"`, others].filter(Boolean).join(' ')
        ),
        count,
        recentFirst: true
      })
      if (chars.length >= 5 && chars.length <= 10 && !/[*?]/.test(parsed.terms[index])) {
        const patterns = chars.map(
          (_, i) => `"*${chars.map((ch, j) => (j === i ? '?' : ch)).join('')}*"`
        )
        queries.push({
          id: 'typo',
          search: withFilters([`<${patterns.join('|')}>`, others].filter(Boolean).join(' ')),
          count,
          recentFirst: true
        })
      }
    }
  }
  return queries
}

const readingCache = new Map<string, string[]>()

/**
 * List the toneless pinyin readings of one character, including alternative readings.
 * @param ch Single character.
 * @returns Lower-case readings ("ü" written as "v"); empty for non-Chinese characters.
 */
export function pinyinReadings(ch: string): string[] {
  if (!HAN.test(ch)) return []
  let readings = readingCache.get(ch)
  if (!readings) {
    try {
      readings = [
        ...new Set(
          pinyin(ch, { toneType: 'none', type: 'array', multiple: true, v: true })
            .map((reading) => reading.toLowerCase())
            .filter((reading) => /^[a-z]+$/.test(reading))
        )
      ]
    } catch {
      readings = []
    }
    readingCache.set(ch, readings)
  }
  return readings
}

/**
 * Match a letters-only word against a name by full pinyin, initials, or a mix of both.
 * @param chars Name split into characters.
 * @param stemLength Number of characters before the extension.
 * @param term Lower-case letters typed by the user.
 * @param preparedReadings Cached readings for each name character.
 * @returns Score (whole name < name start < inside the name), or null without a match.
 */
function pinyinScore(
  chars: string[],
  stemLength: number,
  term: string,
  preparedReadings?: string[][]
): number | null {
  if (!/^[a-z]{2,}$/.test(term)) return null
  /**
   * Consume the word from character `pos`; each Chinese character takes a full reading or its
   * initial, and the last one may be a partly typed reading.
   * @param pos Current character index in the name.
   * @param offset Number of letters already consumed.
   * @param han Number of Chinese characters consumed so far.
   * @returns Index after the last consumed character, or -1.
   */
  const consume = (pos: number, offset: number, han: number): number => {
    if (offset === term.length) return han >= 2 ? pos : -1
    if (pos >= chars.length) return -1
    const readings = preparedReadings?.[pos] || pinyinReadings(chars[pos])
    if (!readings.length) {
      return chars[pos] === term[offset] ? consume(pos + 1, offset + 1, han) : -1
    }
    for (const reading of readings) {
      if (term.startsWith(reading, offset)) {
        // A complete reading of a single character is a match on its own ("jia" finds 家).
        if (offset + reading.length === term.length && han === 0) return pos + 1
        const end = consume(pos + 1, offset + reading.length, han + 1)
        if (end >= 0) return end
      }
    }
    for (const reading of readings) {
      if (reading[0] === term[offset]) {
        const end = consume(pos + 1, offset + 1, han + 1)
        if (end >= 0) return end
      }
    }
    // The final letters may be the beginning of the next character's reading while typing.
    const tail = term.slice(offset)
    if (han >= 1 && tail.length > 1 && readings.some((reading) => reading.startsWith(tail)))
      return pos + 1
    return -1
  }
  let best: number | null = null
  for (let start = 0; start < chars.length; start++) {
    if (
      !(preparedReadings?.[start] || pinyinReadings(chars[start])).some(
        (reading) => reading[0] === term[0]
      )
    )
      continue
    const end = consume(start, 0, 0)
    if (end < 0) continue
    const score = MATCH_SCORE.pinyin + (start === 0 ? (end >= stemLength ? 0 : 2) : 4)
    if (best === null || score < best) best = score
    if (start === 0) break
  }
  return best
}

/**
 * Match a word whose characters appear in order with a few extra characters in between
 * ("家人" finds "家里人").
 * @param chars Name split into characters.
 * @param term Normalized query word.
 * @returns Score growing with the number of inserted characters, or null.
 */
function gapScore(chars: string[], term: string): number | null {
  const wanted = [...term]
  const han = HAN.test(term)
  if (wanted.length < (han ? 2 : 4)) return null
  const maxGap = han ? 2 : 1
  const maxTotal = han ? 3 : 2
  let best: number | null = null
  /**
   * Try to place the remaining characters starting at `pos`.
   * @param pos Next candidate index in the name.
   * @param index Next wanted character.
   * @param total Characters inserted so far.
   * @returns No return value; updates `best`.
   */
  const place = (pos: number, index: number, total: number): void => {
    if (best !== null && total >= best) return
    if (index === wanted.length) {
      best = total
      return
    }
    for (let gap = 0; gap <= maxGap && total + gap <= maxTotal; gap++) {
      if (chars[pos + gap] === wanted[index]) place(pos + gap + 1, index + 1, total + gap)
    }
  }
  for (let start = 0; start < chars.length; start++) {
    if (chars[start] === wanted[0]) place(start + 1, 1, 0)
  }
  return best === null || best === 0 ? null : MATCH_SCORE.gap + best
}

/**
 * Number of wrong characters tolerated for a word: none for short input.
 * @param term Normalized query word.
 * @returns 0, 1 or 2.
 */
export function allowedTypos(term: string): number {
  const length = [...term].length
  if (HAN.test(term)) return length >= 6 ? 2 : length >= 3 ? 1 : 0
  return length >= 5 ? 1 : 0
}

/**
 * Match a word with a limited number of replaced characters ("朱元昊" finds "朱元欣").
 * @param chars Name split into characters.
 * @param term Normalized query word.
 * @returns Score growing with the number of wrong characters, or null.
 */
function typoScore(chars: string[], term: string): number | null {
  const wanted = [...term]
  const limit = allowedTypos(term)
  if (!limit) return null
  let best: number | null = null
  for (let start = 0; start + wanted.length <= chars.length; start++) {
    let wrong = 0
    for (let i = 0; i < wanted.length && wrong <= limit; i++) {
      if (chars[start + i] !== wanted[i]) wrong++
    }
    if (wrong === 0 || wrong > limit) continue
    // A wrong first character is less likely than a wrong later one.
    const score = MATCH_SCORE.typo + wrong * 2 + (chars[start] !== wanted[0] ? 1 : 0)
    if (best === null || score < best) best = score
  }
  return best
}

/**
 * Remove the extension of a file name; folder names are kept whole.
 * @param name Normalized name.
 * @param isFolder Whether the item is a folder.
 * @returns Name without its last extension.
 */
function stemOf(name: string, isFolder: boolean): string {
  const dot = name.lastIndexOf('.')
  return isFolder || dot <= 0 ? name : name.slice(0, dot)
}

export interface PreparedFileName {
  name: string
  stem: string
  fullPath: string
  chars: string[]
  readings: string[][]
  stemLength: number
}

/**
 * Prepare normalized names and cached character readings once per indexed candidate.
 * @param item Name, full path and folder flag.
 * @returns Reusable immutable scoring data.
 */
export function prepareFileName(item: {
  name: string
  path: string
  isFolder: boolean
}): PreparedFileName {
  const name = normalizeSearchText(item.name)
  const stem = stemOf(name, item.isFolder)
  const chars = [...name]
  return {
    name,
    stem,
    fullPath: normalizeSearchText(item.path),
    chars,
    readings: chars.map(pinyinReadings),
    stemLength: [...stem].length
  }
}

/**
 * Score one query word against one name.
 * @param name Normalized name.
 * @param stem Normalized name without extension.
 * @param term Normalized query word.
 * @param fuzzy Whether pinyin, insertion and typo matches are allowed.
 * @param prepared Optional precomputed name data.
 * @returns Lower-is-better score, or null when the word does not match.
 */
function scoreTerm(
  name: string,
  stem: string,
  term: string,
  fuzzy: boolean,
  prepared?: PreparedFileName
): number | null {
  if (stem === term || name === term) return MATCH_SCORE.exact
  if (name.startsWith(term)) return MATCH_SCORE.prefix
  if (name.includes(term)) return MATCH_SCORE.contains
  if (!fuzzy) return null
  const chars = prepared?.chars || [...name]
  const candidates = [
    pinyinScore(chars, prepared?.stemLength ?? [...stem].length, term, prepared?.readings),
    gapScore(chars, term),
    typoScore(chars, term)
  ].filter((score): score is number => score !== null)
  return candidates.length ? Math.min(...candidates) : null
}

/**
 * Score a file or folder against all query words (AND). The worst word decides the tier, so a
 * result where every word matches literally always precedes one that needed fuzzy matching.
 * @param item Name, full path and kind of the candidate.
 * @param terms Normalized query words.
 * @param fuzzy Whether fuzzy matching is allowed.
 * @param prepared Optional precomputed name data.
 * @returns Lower-is-better score, or null when any word fails to match.
 */
export function scoreFileName(
  item: { name: string; path: string; isFolder: boolean },
  terms: string[],
  fuzzy: boolean,
  prepared?: PreparedFileName
): number | null {
  const name = prepared?.name || normalizeSearchText(item.name)
  const stem = prepared?.stem || stemOf(name, item.isFolder)
  const fullPath = prepared?.fullPath || normalizeSearchText(item.path)
  let worst = 0
  let sum = 0
  for (const term of terms) {
    const score = isPathTerm(term)
      ? fullPath.includes(term.replace(/\//g, '\\'))
        ? MATCH_SCORE.contains
        : null
      : scoreTerm(name, stem, term, fuzzy, prepared)
    if (score === null) return null
    worst = Math.max(worst, score)
    sum += score
  }
  if (terms.length > 1) {
    // Several words typed exactly as they appear in the name count as one literal phrase.
    const phrase = terms.join(' ')
    if (stem === phrase || name === phrase) worst = MATCH_SCORE.exact
    else if (name.startsWith(phrase)) worst = Math.min(worst, MATCH_SCORE.prefix)
  }
  return worst * 1000 + Math.min(sum, 999)
}

/**
 * Tell literal matches from fuzzy ones.
 * @param score Score from scoreFileName.
 * @returns True for pinyin, insertion and typo matches.
 */
export function isFuzzyScore(score: number): boolean {
  return score >= MATCH_SCORE.pinyin * 1000
}

/**
 * Check a full path against the exclusion list.
 * @param fullPath Full path of a file or folder.
 * @param excludes Path fragments; compared case-insensitively.
 * @returns Whether the item must be hidden.
 */
export function isExcludedPath(fullPath: string, excludes: string[]): boolean {
  if (!excludes.length) return false
  const target = (fullPath + '\\').toLowerCase()
  return excludes.some((entry) => entry && target.includes(entry.toLowerCase()))
}

/**
 * Classify an item for type filtering and icons.
 * @param name File or folder name.
 * @param isFolder Whether the item is a folder.
 * @returns Matching type filter id, or "other".
 */
export function fileCategory(name: string, isFolder: boolean): FileTypeFilter | 'other' {
  if (isFolder) return 'folder'
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return FILE_TYPE_FILTERS.find((filter) => filter.extensions.includes(extension))?.id ?? 'other'
}

/**
 * Keep literal matches before fuzzy matches, then apply the chosen field or relevance/history order.
 * @param items Scored candidates.
 * @param sort Requested order.
 * @param history Trusted opening history used only within relevance tiers.
 * @param direction Direction for explicit secondary sorts.
 * @returns A new sorted array.
 */
export function sortFileResults(
  items: FileSearchItem[],
  sort: FileSearchSort,
  history: FileSearchHistory = {},
  direction: 'asc' | 'desc' = sort === 'recent' ? 'desc' : 'asc'
): FileSearchItem[] {
  const sign = direction === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    // A fuzzy hit must never displace a literal hit, regardless of secondary ordering.
    const group = Number(isFuzzyScore(a.score)) - Number(isFuzzyScore(b.score))
    if (group) return group
    if (sort !== 'relevance') {
      if (sort === 'type' && a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      const delta =
        sort === 'recent'
          ? (a.modified || 0) - (b.modified || 0)
          : sort === 'size'
            ? (a.size || 0) - (b.size || 0)
            : sort === 'type'
              ? fileCategory(a.name, a.isFolder).localeCompare(fileCategory(b.name, b.isFolder))
              : a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
      return delta * sign || a.path.localeCompare(b.path)
    }
    const tier = Math.floor(a.score / 10000) - Math.floor(b.score / 10000)
    if (tier) return tier
    const ha = history[a.path.toLowerCase()]
    const hb = history[b.path.toLowerCase()]
    return (
      (hb?.count || 0) - (ha?.count || 0) ||
      (hb?.lastOpened || 0) - (ha?.lastOpened || 0) ||
      a.score - b.score ||
      a.name.length - b.name.length ||
      (b.modified || 0) - (a.modified || 0) ||
      a.path.localeCompare(b.path)
    )
  })
}

/**
 * Whether a name contains Chinese characters and therefore belongs in the pinyin name index.
 * @param name File or folder name.
 * @returns True when at least one Chinese character is present.
 */
export function hasChinese(name: string): boolean {
  return HAN.test(name)
}

/**
 * Whether the slower second-phase search could add results for this query.
 * @param query File query without the "f " prefix.
 * @param mode Current matching mode.
 * @returns True in fuzzy mode when a non-Chinese word is long enough for typo/insertion search.
 */
export function needsDeepSearch(query: string, mode: FileSearchMode): boolean {
  const parsed = parseFileQuery(query)
  return mode === 'fuzzy' && parsed.kind === 'terms' && parsed.terms.some(isDeepFuzzyTerm)
}

/**
 * Split a name into plain and matched pieces so literal hits can be emphasized without HTML.
 * @param name Original file or folder name.
 * @param query File query without the "f " prefix.
 * @returns Pieces in order; a single plain piece when nothing can be highlighted.
 */
export function highlightSegments(name: string, query: string): { text: string; hit: boolean }[] {
  const parsed = parseFileQuery(query)
  const lower = name.toLowerCase()
  // Case folding that changes the length would misalign the marks; show such names plainly.
  if (parsed.kind !== 'terms' || lower.length !== name.length) return [{ text: name, hit: false }]
  const marks = new Array<boolean>(name.length).fill(false)
  for (const term of parsed.terms) {
    if (isPathTerm(term)) continue
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) {
      marks.fill(true, at, at + term.length)
    }
  }
  const segments: { text: string; hit: boolean }[] = []
  for (let i = 0; i < name.length; i++) {
    const last = segments[segments.length - 1]
    if (last && last.hit === marks[i]) last.text += name[i]
    else segments.push({ text: name[i], hit: marks[i] })
  }
  return segments.length ? segments : [{ text: name, hit: false }]
}
