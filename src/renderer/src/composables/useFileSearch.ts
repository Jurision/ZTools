import {
  needsDeepSearch,
  type FileSearchRequest,
  type FileSearchItem,
  type FileSearchResponse
} from '@shared/fileSearch'
import { onUnmounted, ref, watch, type Ref } from 'vue'
import { useWindowStore } from '../stores/windowStore'

interface FileSearchOptions {
  /** File query without the "f " prefix; an empty string clears the results. */
  query: () => string
  /** Maximum number of rows to show. */
  limit: number
  /** Requests on one channel supersede each other in the main process. */
  channel: string
  /** Also run the slower typo/insertion search for non-Chinese words. */
  deep?: boolean
  /** Wait this long after the last change before searching. */
  debounceMs?: number
}

interface FileSearchState {
  items: Ref<FileSearchItem[]>
  total: Ref<number>
  status: Ref<FileSearchResponse['status'] | 'idle'>
  message: Ref<string>
  loading: Ref<boolean>
}

/**
 * Search disk files as the query, toolbar choices or exclusions change. Only the latest request
 * may update the state, so slow answers for older text never overwrite newer results.
 * @param options Query source, row limit and channel name.
 * @returns Reactive results and status.
 */
export function useFileSearch(options: FileSearchOptions): FileSearchState {
  const windowStore = useWindowStore()
  const items = ref<FileSearchItem[]>([])
  const total = ref(0)
  const status = ref<FileSearchResponse['status'] | 'idle'>('idle')
  const message = ref('')
  const loading = ref(false)
  const refreshRevision = ref(0)
  const removeRefreshListener = window.ztools.onFileSearchRefresh(() => {
    refreshRevision.value++
  })
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  /**
   * Show one answer if it still belongs to the latest request.
   * @param current Sequence number of the request.
   * @param response Answer from the main process.
   * @returns Whether the answer was applied.
   */
  function apply(current: number, response: FileSearchResponse): boolean {
    if (current !== sequence || response.status === 'cancelled') return false
    items.value = response.items
    total.value = response.total
    status.value = response.status
    message.value = response.message || ''
    return true
  }

  /**
   * Run the fast search, then the slower fuzzy pass when it can add results.
   * @param query File query to search for.
   * @returns Completes after the last phase was applied or superseded.
   */
  async function run(query: string): Promise<void> {
    const current = ++sequence
    // Main-box previews must not inherit the dedicated page's remembered filters or sorting.
    const view =
      options.channel === 'main'
        ? {
            mode: 'fuzzy' as const,
            types: [],
            sort: 'relevance' as const,
            direction: 'asc' as const
          }
        : windowStore.fileSearchView
    const request: FileSearchRequest = {
      query,
      mode: view.mode,
      types: [...view.types],
      sort: options.channel === 'main' ? 'relevance' : view.sort,
      direction: options.channel === 'main' ? 'asc' : view.direction,
      limit: options.limit,
      excludes: [...windowStore.fileSearch.excludes],
      hiddenPaths: [...(windowStore.fileSearch.hiddenPaths || [])],
      channel: options.channel
    }
    loading.value = true
    try {
      const applied = apply(
        current,
        await window.ztools.searchFiles({ ...request, phase: 'literal' })
      )
      if (applied && current === sequence && view.mode === 'fuzzy' && status.value === 'ok')
        apply(
          current,
          await window.ztools.searchFiles({
            ...request,
            phase: 'fuzzy',
            deep: Boolean(options.deep && needsDeepSearch(query, view.mode))
          })
        )
    } catch {
      if (current === sequence) {
        items.value = []
        total.value = 0
        status.value = 'unavailable'
        message.value = '文件搜索出错，请稍后再试。'
      }
    } finally {
      if (current === sequence) loading.value = false
    }
  }

  watch(
    [
      options.query,
      refreshRevision,
      () => (options.channel === 'main' ? null : windowStore.fileSearchView),
      () => windowStore.fileSearch.excludes.join('\n'),
      () => (windowStore.fileSearch.hiddenPaths || []).join('\n')
    ],
    ([query]) => {
      clearTimeout(timer)
      // Invalidate immediately, including the debounce interval before the next request starts.
      sequence++
      // Old rows must not remain actionable while the text or filters already describe a new search.
      items.value = []
      total.value = 0
      status.value = 'idle'
      message.value = ''
      loading.value = Boolean(query)
      if (!query) {
        return
      }
      timer = setTimeout(() => void run(query), options.debounceMs ?? 150)
    },
    { immediate: true }
  )

  onUnmounted(() => {
    removeRefreshListener()
    clearTimeout(timer)
    sequence++
  })

  return { items, total, status, message, loading }
}
