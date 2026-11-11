import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

export interface FakeEverythingItem {
  /** Full path including the name. */
  path: string
  folder?: boolean
  size?: number
  /** Milliseconds since the Unix epoch. */
  modified?: number
  created?: number
}

export interface FakeEverything {
  port: number
  /** Path of a settings file pointing at this server, for ZTOOLS_EVERYTHING_INI. */
  iniPath: string
  /** Every search expression received, in order. */
  searches: string[]
  close: () => Promise<void>
}

const USERNAME = 'ztools-test'
const PASSWORD = 'fixture-only-password'
const FILETIME_EPOCH_OFFSET_MS = 11644473600000

/**
 * Convert an Everything wildcard pattern to a regular expression.
 * @param pattern Pattern using "*" and "?".
 * @returns Case-insensitive whole-name matcher.
 */
function wildcard(pattern: string): RegExp {
  const body = pattern
    .replace(/[\\^$.+()[\]{}|]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${body}$`, 'iu')
}

/**
 * Evaluate one search atom the way Everything does for the syntax ZTools generates.
 * @param atom Single term such as "abc", wfn:"abc", startwith:"abc", regex:"..", folder: or ext:a;b.
 * @param item Candidate item.
 * @returns Whether the item matches the atom.
 */
function matchAtom(atom: string, item: FakeEverythingItem): boolean {
  const name = path.win32.basename(item.path)
  const lowerName = name.toLowerCase()
  const quoted = /^(?:([a-z]+):)?"([^"]*)"$/.exec(atom)
  if (/^(dm|dc):/.test(atom)) {
    const since = new Date(atom.slice(3).replace(/\.\.$/, '')).getTime()
    return (atom.startsWith('dm:') ? item.modified || 0 : item.created || 0) >= since
  }
  if (atom === 'folder:') return item.folder === true
  if (atom.startsWith('ext:')) {
    const extension = path.win32.extname(name).slice(1).toLowerCase()
    return !item.folder && atom.slice(4).split(';').includes(extension)
  }
  if (atom.startsWith('regex:') && !quoted) return new RegExp(atom.slice(6), 'iu').test(name)
  if (!quoted) return lowerName.includes(atom.toLowerCase())
  const [, modifier, text] = quoted
  const value = text.toLowerCase()
  if (modifier === 'filelist') return value.split('|').includes(item.path.toLowerCase())
  if (modifier === 'regex') return new RegExp(text, 'iu').test(name)
  if (modifier === 'wfn') return /[*?]/.test(text) ? wildcard(text).test(name) : lowerName === value
  if (modifier === 'startwith') return lowerName.startsWith(value)
  if (/[*?]/.test(text)) return wildcard(text).test(name)
  // A term containing a path separator is matched against the whole path.
  return /[\\:]/.test(text) ? item.path.toLowerCase().includes(value) : lowerName.includes(value)
}

/**
 * Evaluate a whole search expression: AND-ed terms, <a|b> groups and !"..." exclusions.
 * @param search Search expression sent by ZTools.
 * @param item Candidate item.
 * @returns Whether the item matches.
 */
function matchSearch(search: string, item: FakeEverythingItem): boolean {
  const tokens = search.match(/!"[^"]*"|<[^>]*>|[a-z]+:"[^"]*"|"[^"]*"|\S+/gi) || []
  return tokens.every((token) => {
    if (token.startsWith('!"'))
      return !(item.path + '\\').toLowerCase().includes(token.slice(2, -1).toLowerCase())
    if (token.startsWith('<'))
      return token
        .slice(1, -1)
        .split('|')
        .some((atom) => matchAtom(atom, item))
    return matchAtom(token, item)
  })
}

/**
 * Start a local stand-in for Everything's HTTP server holding a fixed list of items.
 * @param items Files and folders the fake index contains.
 * @param directory Existing temporary folder for the generated settings file.
 * @returns Port, settings file path, received searches and a close function.
 */
export async function startFakeEverything(
  items: FakeEverythingItem[],
  directory: string
): Promise<FakeEverything> {
  const searches: string[] = []
  const expected = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')
  const server = http.createServer((request, response) => {
    // Like the real server, reject requests without the configured credentials.
    if (request.headers.authorization !== expected) {
      response.writeHead(401).end()
      return
    }
    const params = new URL(request.url || '/', 'http://127.0.0.1').searchParams
    const search = params.get('search') || ''
    searches.push(search)
    let matched = items.filter((item) => matchSearch(search, item))
    if (params.get('sort') === 'date_modified')
      matched = [...matched].sort((a, b) => (b.modified || 0) - (a.modified || 0))
    const body = JSON.stringify({
      totalResults: matched.length,
      results: matched.slice(0, Number(params.get('count')) || 32).map((item) => ({
        type: item.folder ? 'folder' : 'file',
        name: path.win32.basename(item.path),
        path: path.win32.dirname(item.path),
        size: item.folder ? '' : String(item.size ?? 0),
        date_modified: item.modified
          ? String((item.modified + FILETIME_EPOCH_OFFSET_MS) * 10000)
          : ''
      }))
    })
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const iniPath = path.join(directory, 'Everything.ini')
  fs.writeFileSync(
    iniPath,
    [
      '[Everything]',
      'allow_http_server=1',
      'http_server_enabled=1',
      'index_date_created=1',
      'http_server_bindings=127.0.0.1',
      `http_server_port=${port}`,
      `http_server_username=${USERNAME}`,
      `http_server_password=${PASSWORD}`,
      ''
    ].join('\r\n'),
    'latin1'
  )
  return {
    port,
    iniPath,
    searches,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

const DAY = 24 * 60 * 60 * 1000
const BASE = Date.UTC(2026, 0, 1)

/** A small disk shared by unit and end-to-end tests; names mirror the acceptance examples. */
export const FAKE_DISK: FakeEverythingItem[] = [
  { path: 'C:\\Users\\me\\Pictures\\Camera Roll\\家人', folder: true, modified: BASE + 5 * DAY },
  { path: 'E:\\备份\\惠普备份\\家人', folder: true, modified: BASE + 4 * DAY },
  { path: 'E:\\备份\\QQ空间备份\\相册\\最爱\\家人。', folder: true, modified: BASE + 3 * DAY },
  {
    path: 'E:\\金融书籍\\收入倍增理财学 做自己和家人的理财达人(高清).pdf',
    size: 44857380,
    modified: BASE + 9 * DAY
  },
  { path: 'E:\\照片\\家里人.jpg', size: 2048, modified: BASE + 8 * DAY },
  { path: 'E:\\文档\\朱元欣简历.docx', size: 4096, modified: BASE + 7 * DAY },
  { path: 'E:\\文档\\朱元昊开题报告.docx', size: 8192, modified: BASE + 6 * DAY },
  { path: 'C:\\Windows\\System32\\家人.dll', size: 100, modified: BASE + 20 * DAY },
  { path: 'D:\\code\\node_modules\\家人\\index.js', size: 100, modified: BASE + 21 * DAY },
  { path: 'D:\\相册\\家人 照片 2020.zip', size: 999, modified: BASE + 2 * DAY },
  { path: 'D:\\相册\\家人合影\\照片001.jpg', size: 555, modified: BASE + DAY },
  { path: 'D:\\work\\report.pdf', size: 1000, modified: BASE + 10 * DAY },
  { path: 'D:\\work\\Annual Report 2024.xlsx', size: 2000, modified: BASE + 11 * DAY },
  { path: 'D:\\work\\repart-notes.txt', size: 300, modified: BASE + 12 * DAY },
  { path: 'D:\\work\\re-port.txt', size: 300, modified: BASE + 13 * DAY },
  { path: 'D:\\work\\ＡＢＣ全角.txt', size: 10, modified: BASE + 14 * DAY },
  { path: 'D:\\work\\unrelated.txt', size: 10, modified: BASE + 15 * DAY }
]
