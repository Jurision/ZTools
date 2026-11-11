import { needsDeepSearch, type FileSearchItem, type FileSearchResponse } from '@shared/fileSearch'
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
    const view = windowStore.fileSearchView
    const request = {
      query,
      mode: view.mode,
      types: [...view.types],
      sort: view.sort,
      limit: options.limit,
      excludes: [...windowStore.fileSearch.excludes],
      channel: options.channel
    }
    loading.value = true
    try {
      const applied = apply(current, await window.ztools.searchFiles(request))
      if (applied && options.deep && status.value === 'ok' && needsDeepSearch(query, view.mode))
        apply(current, await window.ztools.searchFiles({ ...request, deep: true }))
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
      () => windowStore.fileSearchView,
      () => windowStore.fileSearch.excludes.join('\n')
    ],
    ([query]) => {
      clearTimeout(timer)
      if (!query) {
        // Invalidate anything in flight so a late answer cannot bring old rows back.
        sequence++
        items.value = []
        total.value = 0
        status.value = 'idle'
        message.value = ''
        loading.value = false
        return
      }
      timer = setTimeout(() => void run(query), options.debounceMs ?? 150)
    },
    { immediate: true }
  )

  onUnmounted(() => {
    clearTimeout(timer)
    sequence++
  })

  return { items, total, status, message, loading }
}
