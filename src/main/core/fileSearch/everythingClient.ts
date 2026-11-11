import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { EverythingQuery } from '@shared/fileSearch'

export interface EverythingEndpoint {
  port: number
  username: string
  password: string
}

export interface EverythingRawItem {
  name: string
  /** Parent folder path. */
  dir: string
  isFolder: boolean
  size?: number
  /** Milliseconds since the Unix epoch. */
  modified?: number
}

export interface EverythingQueryResult {
  total: number
  items: EverythingRawItem[]
}

/** Offset between the Windows FILETIME epoch (1601) and the Unix epoch, in milliseconds. */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000
const agent = new http.Agent({ keepAlive: true, maxSockets: 6 })

/**
 * Read the local query port and credentials from Everything's own settings file.
 * @param text Content of Everything.ini.
 * @returns Connection details, or null when the local HTTP server is switched off or invalid.
 */
export function parseEverythingIni(text: string): EverythingEndpoint | null {
  const read = (key: string): string =>
    new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? ''
  const port = Number(read('http_server_port'))
  if (read('http_server_enabled') !== '1' || read('allow_http_server') === '0') return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    port,
    username: read('http_server_username'),
    password: read('http_server_password')
  }
}

/**
 * Locate Everything's settings file. Tests may only use an explicitly provided fixture so they
 * can never query the real disk index.
 * @param env Process environment.
 * @returns Absolute path of Everything.ini, or null when file search must stay off.
 */
export function resolveEverythingIniPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ZTOOLS_EVERYTHING_INI) return env.ZTOOLS_EVERYTHING_INI
  if (env.ZTOOLS_E2E === '1' || env.ZTOOLS_BACKGROUND_TEST === '1' || env.VITEST) return null
  if (process.platform !== 'win32' || !env.APPDATA) return null
  return path.join(env.APPDATA, 'Everything', 'Everything.ini')
}

let cachedEndpoint: { file: string; mtimeMs: number; endpoint: EverythingEndpoint | null } | null =
  null

/**
 * Load the connection details, re-reading the settings file only after it changed.
 * @returns Connection details, or null when Everything is not set up for local queries.
 */
export async function loadEverythingEndpoint(): Promise<EverythingEndpoint | null> {
  const file = resolveEverythingIniPath()
  if (!file) return null
  try {
    const stat = await fs.promises.stat(file)
    if (cachedEndpoint?.file === file && cachedEndpoint.mtimeMs === stat.mtimeMs)
      return cachedEndpoint.endpoint
    // The settings file is ANSI/ASCII; latin1 keeps every byte without throwing on odd characters.
    const endpoint = parseEverythingIni(await fs.promises.readFile(file, 'latin1'))
    cachedEndpoint = { file, mtimeMs: stat.mtimeMs, endpoint }
    return endpoint
  } catch {
    return null
  }
}

let lastStartAttempt = 0

/**
 * Start Everything in the background when it is installed but not running. Never used in tests.
 * @returns Whether a start was attempted.
 */
export function startEverythingInBackground(): boolean {
  if (process.platform !== 'win32' || process.env.ZTOOLS_EVERYTHING_INI) return false
  if (resolveEverythingIniPath() === null) return false
  // One attempt per half minute is enough; a missing program must not be retried per keystroke.
  if (Date.now() - lastStartAttempt < 30_000) return false
  lastStartAttempt = Date.now()
  const exe = path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'Everything',
    'Everything.exe'
  )
  if (!fs.existsSync(exe)) return false
  try {
    // "-startup" keeps Everything in the notification area without opening its window.
    const child = spawn(exe, ['-startup'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    // Spawn can fail asynchronously (for example after removal). The connection probe reports
    // unavailability; an unhandled child-process error must never terminate ZTools.
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * Run one query against the local Everything HTTP server (always 127.0.0.1).
 * @param endpoint Port and credentials.
 * @param query Search expression, result count and order.
 * @param signal Cancels the request.
 * @param timeoutMs Give up after this long.
 * @returns Total match count and the returned items.
 * @throws When Everything is unreachable, rejects the credentials or answers with invalid data.
 */
export function queryEverything(
  endpoint: EverythingEndpoint,
  query: Pick<EverythingQuery, 'search' | 'count' | 'recentFirst'>,
  signal?: AbortSignal,
  timeoutMs = 8000
): Promise<EverythingQueryResult> {
  const params = new URLSearchParams({
    search: query.search,
    json: '1',
    path_column: '1',
    size_column: '1',
    date_modified_column: '1',
    count: String(query.count)
  })
  if (query.recentFirst) {
    params.set('sort', 'date_modified')
    params.set('ascending', '0')
  }
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        path: '/?' + params.toString(),
        agent,
        signal,
        timeout: timeoutMs,
        headers: endpoint.username
          ? {
              Authorization:
                'Basic ' +
                Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64')
            }
          : {}
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Everything HTTP ${response.statusCode}`))
            return
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const items: EverythingRawItem[] = []
            for (const row of Array.isArray(data?.results) ? data.results : []) {
              if (typeof row?.name !== 'string' || typeof row?.path !== 'string') continue
              const size = Number(row.size)
              const fileTime = Number(row.date_modified)
              items.push({
                name: row.name,
                dir: row.path,
                isFolder: row.type === 'folder',
                size: row.size !== '' && Number.isFinite(size) ? size : undefined,
                modified:
                  row.date_modified && Number.isFinite(fileTime) && fileTime > 0
                    ? Math.round(fileTime / 10000 - FILETIME_EPOCH_OFFSET_MS)
                    : undefined
              })
            }
            resolve({ total: Number(data?.totalResults) || 0, items })
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.on('timeout', () => request.destroy(new Error('Everything query timed out')))
    request.on('error', reject)
  })
}
