<template>
  <div class="file-search-page" @click="emit('focus-input')">
    <div class="file-toolbar" @mousedown="keepSearchFocus">
      <button type="button" class="file-type-option file-search-back" @click.stop="emit('exit')">
        ← 返回搜索
      </button>
      <div class="file-segment" role="group" aria-label="匹配方式">
        <button
          type="button"
          data-mode="fuzzy"
          :class="{ active: view.mode === 'fuzzy' }"
          title="允许拼音、中间插字和少量错字"
          @click.stop="windowStore.updateFileSearchView({ mode: 'fuzzy' })"
        >
          模糊
        </button>
        <button
          type="button"
          data-mode="exact"
          :class="{ active: view.mode === 'exact' }"
          title="只找文件名里原样包含这些字的"
          @click.stop="windowStore.updateFileSearchView({ mode: 'exact' })"
        >
          精确
        </button>
      </div>
      <button
        type="button"
        class="file-type-toggle"
        :class="{ active: typesOpen || view.types.length > 0 }"
        :aria-expanded="typesOpen"
        @click.stop="typesOpen = !typesOpen"
      >
        筛选类型：{{ typeSummary }} {{ view.types.length ? `(${view.types.length})` : '' }} ▾
      </button>
      <div class="file-segment" role="group" aria-label="排序">
        <select aria-label="排序方式" :value="view.sort" @change="changeSort" @click.stop>
          <option value="relevance">匹配度</option>
          <option value="recent">最近修改</option>
          <option value="name">名称</option>
          <option value="size">大小</option>
          <option value="type">类型</option>
        </select>
        <button
          v-if="view.sort !== 'relevance'"
          class="file-sort-direction"
          type="button"
          :title="view.direction === 'asc' ? '当前升序，点击降序' : '当前降序，点击升序'"
          @click.stop="
            windowStore.updateFileSearchView({
              direction: view.direction === 'asc' ? 'desc' : 'asc'
            })
          "
        >
          {{ view.direction === 'asc' ? '↑ 升序' : '↓ 降序' }}
        </button>
      </div>
      <span class="file-count" role="status">{{ countText }}</span>
    </div>
    <div v-if="typesOpen" class="file-type-panel" @mousedown.prevent>
      <button
        v-for="filter in FILE_TYPE_FILTERS"
        :key="filter.id"
        type="button"
        class="file-type-option"
        :data-type="filter.id"
        :class="{ active: view.types.includes(filter.id) }"
        :aria-pressed="view.types.includes(filter.id)"
        @click.stop="toggleType(filter.id)"
      >
        {{ filter.label }}
      </button>
      <button
        type="button"
        class="file-type-option file-type-clear"
        :disabled="!view.types.length"
        @click.stop="windowStore.updateFileSearchView({ types: [] })"
      >
        全部类型
      </button>
    </div>
    <div ref="listRef" class="file-list">
      <FileResultRow
        v-for="(item, index) in items"
        :key="item.path"
        :item="item"
        :query="query"
        :selected="index === selectedIndex"
        :notice="notice?.path === item.path ? notice.text : ''"
        @open="(reveal) => openFile(item, reveal)"
        @menu="showMenu(item)"
      />
      <p v-if="hintText" class="file-hint">{{ hintText }}</p>
      <button
        v-if="status === 'ok' && !loading && !items.length && view.types.length"
        class="file-clear-empty-filter"
        type="button"
        @click.stop="windowStore.updateFileSearchView({ types: [] })"
      >
        清除类型筛选，重新搜索
      </button>
    </div>
    <div class="file-footer">
      回车 打开 · Ctrl+回车 打开所在文件夹 · Ctrl+Shift+C 复制路径 · 右键 更多操作 ·
      用空格隔开多个词 · re: 开头按正则搜
    </div>
  </div>
</template>

<script setup lang="ts">
import { FILE_TYPE_FILTERS, type FileTypeFilter, type FileSearchSort } from '@shared/fileSearch'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useFileActions } from '../../composables/useFileActions'
import { useFileSearch } from '../../composables/useFileSearch'
import { useWindowStore } from '../../stores/windowStore'
import FileResultRow from './FileResultRow.vue'

const PAGE_LIMIT = 200

interface Props {
  /** File query without the "f " prefix. */
  query: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'height-changed'): void
  (e: 'focus-input'): void
  (e: 'exit'): void
}>()

const windowStore = useWindowStore()
const view = computed(() => windowStore.fileSearchView)
const typesOpen = ref(false)
const selectedIndex = ref(0)
const listRef = ref<HTMLElement>()

const { items, total, status, message, loading } = useFileSearch({
  query: () => props.query,
  limit: PAGE_LIMIT,
  channel: 'page',
  deep: true
})
const { notice, openFile, copyPath, showMenu, handleMenuCommand, clearNotice } = useFileActions()

const typeSummary = computed(() =>
  view.value.types.length
    ? FILE_TYPE_FILTERS.filter((filter) => view.value.types.includes(filter.id))
        .map((filter) => filter.label)
        .join('、')
    : '全部'
)

const countText = computed(() => {
  if (status.value !== 'ok' || !items.value.length) return loading.value ? '正在搜索…' : ''
  return total.value > items.value.length
    ? `共 ${total.value} 条，显示前 ${items.value.length} 条`
    : `共 ${items.value.length} 条`
})

const hintText = computed(() => {
  if (!props.query) return '输入文件名或文件夹名开始搜索，例如：家人 照片'
  if (status.value === 'unavailable' || status.value === 'invalid') return message.value
  if (status.value === 'ok' && !items.value.length && !loading.value)
    return view.value.mode === 'exact'
      ? '没有找到。可以切到「模糊」再试试。'
      : '没有找到。可以检查类型筛选，或在设置里查看排除的文件夹。'
  return ''
})

/**
 * Keep keyboard search focus for buttons while allowing the native sort selector to open.
 * @param event Toolbar pointer event.
 * @returns No return value.
 */
function keepSearchFocus(event: MouseEvent): void {
  if (!(event.target instanceof HTMLSelectElement)) event.preventDefault()
}

/**
 * Apply the chosen ordering immediately while preserving its remembered direction.
 * @param event Select change event.
 * @returns No return value.
 */
function changeSort(event: Event): void {
  windowStore.updateFileSearchView({
    sort: (event.target as HTMLSelectElement).value as FileSearchSort
  })
}

/**
 * Add or remove one type from the multi-select filter.
 * @param id Type filter to toggle.
 * @returns No return value.
 */
function toggleType(id: FileTypeFilter): void {
  const types = view.value.types.includes(id)
    ? view.value.types.filter((type) => type !== id)
    : [...view.value.types, id]
  windowStore.updateFileSearchView({ types })
}

/**
 * Keep the keyboard-selected row inside the visible part of the list.
 * @returns No return value.
 */
function scrollToSelected(): void {
  nextTick(() => {
    listRef.value?.querySelector('.file-result.selected')?.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * Handle list navigation and file shortcuts forwarded from the search box.
 * @param event Keyboard event from the main window.
 * @returns Completes after the action finished.
 */
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  const count = items.value.length
  const item = items.value[selectedIndex.value]
  const withCommand = event.ctrlKey || event.metaKey
  if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
    event.preventDefault()
    if (count) selectedIndex.value = (selectedIndex.value + 1) % count
  } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
    event.preventDefault()
    if (count) selectedIndex.value = (selectedIndex.value - 1 + count) % count
  } else if (event.key === 'Enter') {
    event.preventDefault()
    // Ctrl+Enter shows the item in its folder instead of opening it.
    if (item) await openFile(item, withCommand)
  } else if (withCommand && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    if (item) await copyPath(item)
  }
}

/**
 * Select the first row again.
 * @returns No return value.
 */
function resetSelection(): void {
  selectedIndex.value = 0
}

watch(
  () => [props.query, view.value],
  () => {
    resetSelection()
    clearNotice()
  }
)
watch(items, () => {
  if (selectedIndex.value >= items.value.length) resetSelection()
})
watch(selectedIndex, scrollToSelected)
// Every change of the rows, hints or the type panel changes the page height.
watch([items, hintText, typesOpen, countText], () => emit('height-changed'), { flush: 'post' })

let removeMenuListener: (() => void) | null = null
onMounted(() => {
  removeMenuListener = window.ztools.onContextMenuCommand((command: string) => {
    void handleMenuCommand(command)
  })
  emit('height-changed')
})
onUnmounted(() => {
  removeMenuListener?.()
  removeMenuListener = null
})

defineExpose({
  handleKeydown,
  resetSelection,
  /** The page has no collapsible sections; kept for the shared keyboard contract. */
  resetCollapseState: (): void => {}
})
</script>

<style scoped>
.file-search-page {
  display: flex;
  flex-direction: column;
  color: var(--text-color);
}
.file-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 14px 8px;
}
.file-segment {
  display: inline-flex;
  border: 1px solid var(--border-color, #8884);
  border-radius: 7px;
  overflow: hidden;
}
.file-segment button,
.file-type-toggle,
.file-type-option {
  padding: 4px 12px;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: none;
  cursor: pointer;
}
.file-segment button.active {
  color: var(--text-color);
  background: var(--primary-light-bg);
  font-weight: 600;
}
.file-type-toggle,
.file-type-option {
  border: 1px solid var(--border-color, #8884);
  border-radius: 7px;
}
.file-type-toggle {
  font-weight: 600;
  border-color: var(--primary-color);
}
.file-type-toggle.active,
.file-type-option.active {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.file-type-option:disabled {
  opacity: 0.45;
  cursor: default;
}
.file-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
.file-type-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 8px;
}
.file-list {
  max-height: 440px;
  overflow-y: auto;
  overflow-x: hidden;
}
.file-hint {
  margin: 0;
  padding: 18px 16px;
  font-size: 13px;
  color: var(--text-secondary);
}
.file-footer {
  padding: 6px 14px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color, #8882);
}
.file-toolbar select {
  color: var(--text-color);
  background: var(--control-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 5px;
}
.file-clear-empty-filter {
  margin: 8px 16px;
  padding: 8px 12px;
  color: var(--text-on-primary);
  background: var(--primary-color);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
</style>
