<template>
  <div ref="scrollContainerRef" class="scrollable-content" @click="handleContainerClick">
    <p v-if="hideError" class="file-preview-hint" role="status">{{ hideError }}</p>
    <button
      v-if="calculation"
      type="button"
      class="quick-result quick-calculation"
      :class="{ selected: selectedQuickType === 'quickCalculation' }"
      @click.stop="
        $event.ctrlKey || $event.metaKey
          ? continueInCalculationPaper()
          : activateQuickResult('quickCalculation')
      "
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v14H4zM7 9h3m-1.5-1.5v3M14 9h3M7 14l3 3m0-3-3 3m7-2h3m-3 2h3" />
      </svg>
      <span
        ><strong>{{ calculation.expression }} = {{ calculation.result }}</strong
        ><small>{{
          copiedKind === 'quickCalculation'
            ? '已复制'
            : paperContinueMissing
              ? '未找到计算稿纸插件'
              : '回车进入稿纸 · Ctrl+回车或点击复制结果'
        }}</small></span
      >
    </button>
    <!-- 聚合模式 -->
    <AggregateView
      v-if="searchMode === 'aggregate'"
      v-model:recent-expanded="isRecentExpanded"
      v-model:pinned-expanded="isPinnedExpanded"
      v-model:search-results-expanded="isSearchResultsExpanded"
      v-model:best-matches-expanded="isBestMatchesExpanded"
      v-model:recommendations-expanded="isRecommendationsExpanded"
      :search-query="searchQuery"
      :pasted-image="pastedImage"
      :pasted-files="pastedFiles"
      :pasted-text="pastedText"
      :best-search-results="bestSearchResults"
      :best-matches="bestMatches"
      :recommendations="recommendationItems"
      :main-push-groups="mainPushGroups"
      :display-apps="displayApps"
      :pinned-apps="pinnedApps"
      :window-matched-actions="windowMatchedActions"
      :window-match-title="windowMatchTitle"
      :navigation-grid="navigationGrid"
      :selected-row="selectedRow"
      :selected-col="selectedCol"
      :loading="loading"
      :show-recent-in-search="showRecentInSearch"
      :recent-rows="windowStore.recentRows"
      :pinned-rows="windowStore.pinnedRows"
      @select="handleSelectApp"
      @select-window="handleWindowAction"
      @select-recommendation="handleRecommendationSelect"
      @select-main-push="handleMainPushSelectAction"
      @enter-main-push-app="handleEnterMainPushApp"
      @contextmenu="handleAppContextMenu"
      @update:pinned-order="updatePinnedOrder"
      @height-changed="emit('height-changed')"
    />

    <!-- 列表模式 -->
    <div v-if="searchMode === 'list' && hasSearchContent" class="list-mode-results">
      <VerticalList
        :apps="allListModeResults"
        :selected-index="listModeSelectedIndex"
        :search-query="searchQuery"
        @select="handleSelectApp"
        @contextmenu="(app) => handleAppContextMenu(app, 'search')"
      />
    </div>
    <button
      v-for="translation in windowStore.translations"
      :key="translation.providerId"
      type="button"
      class="quick-result search-translation"
      :data-provider="translation.providerId"
      :class="{ selected: selectedQuickType === 'quickTranslation:' + translation.providerId }"
      @click.stop="activateQuickResult('quickTranslation:' + translation.providerId)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5h12M9 2v3M5 5c0 5 5 9 9 10M13 5c0 5-5 9-10 10m12 5 4-12 4 12m-7-4h6" />
      </svg>
      <span aria-live="polite"
        ><em class="translation-provider">{{ translation.providerLabel }}</em
        ><strong>{{
          translation.loading ? '正在翻译…' : translation.error || translation.text
        }}</strong>
        <small v-if="translation.phonetic">{{ translation.phonetic }}</small>
        <small
          v-if="
            !translation.loading &&
            !translation.error &&
            /^[a-zA-Z]+$/.test(translation.source) &&
            !translation.phonetic &&
            !translation.meanings?.length
          "
          >服务未返回音标或词典释义</small
        >
        <small v-if="translation.meanings?.length">{{ translation.meanings.join('；') }}</small>
        <small>{{
          copiedKind === 'quickTranslation:' + translation.providerId
            ? '已复制'
            : translation.needsConfiguration
              ? '回车打开翻译设置'
              : translation.error
                ? '请检查翻译设置后重试'
                : translation.loading
                  ? ''
                  : '回车复制译文'
        }}</small>
      </span>
    </button>
    <section v-if="mainFileQuery" class="main-file-preview">
      <button
        type="button"
        class="file-fold"
        :class="{ selected: selectedQuickType === 'fileToggle', expanded: filesExpanded }"
        :aria-expanded="filesExpanded"
        aria-controls="main-file-rows"
        :aria-label="filesExpanded ? '收起文件' : '展开文件'"
        @mousedown.prevent
        @click.stop="toggleFiles"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
      </button>
      <div v-if="filesExpanded" id="main-file-rows">
        <FileResultRow
          v-for="item in fileItems"
          :key="item.path"
          :item="item"
          :query="searchQuery"
          :compact="true"
          :selected="selectedQuickType === 'fileItem' && selectedItem?.path === item.path"
          :notice="fileNotice?.path === item.path ? fileNotice.text : ''"
          @open="(reveal) => openFile(item, reveal)"
          @menu="showFileMenu(item)"
        />
        <p v-if="!fileItems.length" class="file-preview-hint" role="status">
          {{ filesLoading ? '正在搜索…' : fileMessage || '没有找到匹配的文件' }}
        </p>
        <button
          v-if="fileItems.length"
          type="button"
          class="file-page-link"
          :class="{ selected: selectedQuickType === 'fileMore' }"
          aria-label="进入详细文件搜索"
          title="进入详细文件搜索"
          @mousedown.prevent
          @click.stop="emit('enter-file-search')"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-4-4 4 4-4 4" /></svg>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { calculateQuickExpression, findCalculationPaperCommand } from '@shared/quickCalculation'
import { isSearchableFileQuery } from '@shared/fileSearch'
import { isHiddenSearchPath } from '@shared/searchHiddenPaths'
import { useFileSearch } from '../../composables/useFileSearch'
import { useFileActions } from '../../composables/useFileActions'
import FileResultRow from './FileResultRow.vue'
import { allowPluginSearch, isSearchCommandVisible, parseSearchScope } from '@shared/searchSources'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { normalizeConfigList } from '@shared/pluginSettings'
import {
  useMainPushResults,
  type MainPushGroup,
  type MainPushItem
} from '../../composables/useMainPushResults'
import {
  resolveMainPushMenuState,
  toggleMainPushSetting
} from '../../composables/useMainPushSetting'
import { useNavigation } from '../../composables/useNavigation'
import { useSearchResults } from '../../composables/useSearchResults'
import { useCommandDataStore } from '../../stores/commandDataStore'
import { useWindowStore } from '../../stores/windowStore'
import VerticalList from '../common/VerticalList.vue'
import AggregateView from './AggregateView.vue'
import { buildAggregateNavigationGrid } from './navigationGrid'

// MatchFile 接口（传递给插件的文件格式）
interface MatchFile {
  isFile: boolean
  isDirectory: boolean
  name: string
  path: string
}

// FileItem 接口（从剪贴板管理器返回的格式）
interface FileItem {
  path: string
  name: string
  isDirectory: boolean
}

interface Props {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: FileItem[] | null
  pastedText?: string | null
  /** True only when pastedText came from the user's own paste in the search box. */
  pastedTextTranslatable?: boolean
}

type ContextMenuSource = 'history' | 'pinned' | 'search' | 'recommendation'

const props = defineProps<Props>()

const windowStore = useWindowStore()
const searchMode = computed(() => windowStore.searchMode)

const emit = defineEmits<{
  (e: 'height-changed'): void
  (e: 'focus-input'): void
  (e: 'restore-match', state: any): void
  /** Open the dedicated file search page for the current text. */
  (e: 'enter-file-search'): void
}>()

// 使用 store
const commandDataStore = useCommandDataStore()
const { loading } = storeToRefs(commandDataStore)
const {
  getRecentCommands,
  removeFromHistory,
  pinCommand,
  unpinCommand,
  isPinned,
  getRecommendationPinIndex,
  isRecommendationPinned,
  pinRecommendation,
  unpinRecommendation,
  moveRecommendationToFront,
  getPinnedCommands,
  updatePinnedOrder,
  saveSearchPreference,
  loadSuperPanelPinnedData,
  isPinnedToSuperPanel
} = commandDataStore

// 使用搜索结果 composable
const { bestSearchResults, bestMatches, recommendations, allListModeResults } =
  useSearchResults(props)

// Built-in results stay independent of plugin search and never consume pasted attachments automatically.
const calculation = computed(() =>
  windowStore.quickSearch.autoCalculate &&
  !windowStore.currentPlugin &&
  !props.pastedImage &&
  !props.pastedFiles &&
  !props.pastedText
    ? calculateQuickExpression(props.searchQuery)
    : null
)
const copiedKind = ref('')
const hideError = ref('')
const filesExpanded = ref(false)
const mainFileQuery = computed(() =>
  windowStore.fileSearch.enabled &&
  !windowStore.currentPlugin &&
  !calculation.value &&
  !props.pastedImage &&
  !props.pastedFiles &&
  !props.pastedText &&
  isSearchableFileQuery(props.searchQuery)
    ? props.searchQuery.trim()
    : ''
)
const {
  items: fileItems,
  loading: filesLoading,
  message: fileMessage
} = useFileSearch({
  query: () => mainFileQuery.value,
  limit: 6,
  channel: 'main',
  debounceMs: 250
})
const {
  notice: fileNotice,
  openFile,
  copyPath,
  showMenu: showFileMenu,
  handleMenuCommand: handleFileMenuCommand,
  clearNotice: clearFileNotice
} = useFileActions()

/**
 * Expand only the inline preview, retaining search-box focus and the existing query.
 * @returns No return value.
 */
function toggleFiles(): void {
  filesExpanded.value = !filesExpanded.value
  // Keep selection on the disclosure when its formerly selected children disappear.
  if (!filesExpanded.value && selectedQuickType.value?.startsWith('file')) {
    selectedRow.value = navigationGrid.value.findIndex((row) => row.type === 'fileToggle')
    selectedCol.value = 0
  }
  emit('focus-input')
}
const paperContinueMissing = ref(false)
watch(
  () => props.searchQuery,
  () => (paperContinueMissing.value = false)
)
/**
 * Clear stale explicit translations without sending typed or pasted text automatically.
 * @returns No return value.
 */
function clearStaleQuickTranslation(): void {
  copiedKind.value = ''
  if (props.pastedImage || props.pastedFiles || windowStore.currentPlugin) {
    windowStore.clearSearchTranslation()
    return
  }
  const source = (props.searchQuery || props.pastedText || '').trim().replace(/\s+/g, ' ')
  const shown = windowStore.translations[0]?.source
  if (shown && shown !== source) windowStore.clearSearchTranslation()
}
watch(
  [
    () => props.searchQuery,
    () => props.pastedText,
    () => props.pastedImage,
    () => props.pastedFiles,
    () => windowStore.currentPlugin
  ],
  clearStaleQuickTranslation,
  { flush: 'post', immediate: true }
)
onUnmounted(() => {
  windowStore.clearSearchTranslation()
})

// 为推荐项附加仅用于渲染的置顶状态，避免把 UI 字段写入固定列表数据。
const recommendationItems = computed(() =>
  recommendations.value.map((item) => ({
    ...item,
    isPinnedInSearch: isRecommendationPinned(item)
  }))
)

// 使用 mainPush 结果 composable
const { mainPushGroups, handleMainPushSelect } = useMainPushResults(props)

// 内部状态
const scrollContainerRef = ref<HTMLElement>()
const showRecentInSearch = computed(() => windowStore.showRecentInSearch)

// 展示设置插件详情页面对应小项的 payload
type PluginPayload = { pluginName: string; path?: string }

/**
 * 从搜索结果项中提取插件名称载荷。
 */
function getPluginPayload(app: any): PluginPayload | null {
  if (!app?.pluginName) {
    return null
  }
  return { pluginName: app.pluginName, path: app.path }
}

/**
 * 解析右键菜单回传的插件载荷。
 */
function parsePluginPayload(raw: string): PluginPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.pluginName) return null
    return { pluginName: parsed.pluginName, path: parsed.path }
  } catch {
    return null
  }
}

// 是否有搜索内容

const hasSearchContent = computed(() => {
  return !!(props.searchQuery.trim() || props.pastedImage || props.pastedText || props.pastedFiles)
})

// 窗口匹配的操作列表（基于 feature 动态匹配）
const windowMatchedActions = computed(() => {
  if (!allowPluginSearch(props.searchQuery, windowStore.searchSources)) return []
  const currentWindow = windowStore.currentWindow
  if (!currentWindow) {
    return []
  }

  // 使用 commandDataStore 的 searchWindowCommands 进行匹配
  const matched = commandDataStore.searchWindowCommands({
    app: currentWindow.app,
    title: currentWindow.title,
    className: currentWindow.className
  })

  // 如果有搜索内容，在匹配的窗口指令中进一步搜索
  if (props.searchQuery.trim()) {
    return commandDataStore.searchInCommands(matched, parseSearchScope(props.searchQuery).query)
  }

  return matched
})

// 窗口匹配栏的标题（基于当前窗口的 app 名称）
const windowMatchTitle = computed(() => {
  const currentWindow = windowStore.currentWindow
  if (!currentWindow) {
    return ''
  }
  // 提取 app 名称（去掉 .app 后缀）
  const appName = currentWindow.app || ''
  return appName.replace(/\.app$/i, '')
})

// 显示的应用列表
const displayApps = computed(() => {
  if (props.pastedImage || props.pastedText || props.pastedFiles) return []
  if (props.searchQuery.trim() === '') {
    return getRecentCommands().filter((command) =>
      isSearchCommandVisible(command, windowStore.searchSources)
    )
  }
  return []
})

// 固定应用列表
const pinnedApps = computed(() => {
  return getPinnedCommands().filter(
    (item) => !isHiddenSearchPath(item.path, windowStore.searchSources.hiddenApplicationPaths)
  )
})

// 折叠状态（提升到这里统一管理）
const isRecentExpanded = ref(false)
const isPinnedExpanded = ref(false)
const isSearchResultsExpanded = ref(false)
const isBestMatchesExpanded = ref(false)
const isRecommendationsExpanded = ref(false)

// 构建导航网格
const baseNavigationGrid = computed(() => {
  // 列表模式：使用一维数组（每个项目占一行）
  if (searchMode.value === 'list') {
    if (!hasSearchContent.value) {
      return []
    }
    return allListModeResults.value.map((item: any) => ({ type: 'listItem', items: [item] }))
  }

  return buildAggregateNavigationGrid({
    hasSearchContent: hasSearchContent.value,
    bestSearchResults: bestSearchResults.value,
    bestMatches: bestMatches.value,
    recommendations: recommendationItems.value,
    mainPushGroups: mainPushGroups.value,
    windowMatchedActions: windowMatchedActions.value,
    displayApps: displayApps.value,
    pinnedApps: pinnedApps.value,
    showRecentInSearch: showRecentInSearch.value,
    recentExpanded: isRecentExpanded.value,
    pinnedExpanded: isPinnedExpanded.value,
    searchResultsExpanded: isSearchResultsExpanded.value,
    bestMatchesExpanded: isBestMatchesExpanded.value,
    recommendationsExpanded: isRecommendationsExpanded.value,
    recentRows: windowStore.recentRows,
    pinnedRows: windowStore.pinnedRows
  })
})

const navigationGrid = computed(() => [
  ...(calculation.value ? [{ type: 'quickCalculation', items: [calculation.value] }] : []),
  ...baseNavigationGrid.value,
  ...windowStore.translations.map((translation) => ({
    type: 'quickTranslation:' + translation.providerId,
    items: [translation]
  })),
  ...(mainFileQuery.value ? [{ type: 'fileToggle', items: [{}] }] : []),
  ...(mainFileQuery.value && filesExpanded.value
    ? [
        ...fileItems.value.map((item) => ({ type: 'fileItem', items: [item] })),
        ...(fileItems.value.length ? [{ type: 'fileMore', items: [{}] }] : [])
      ]
    : [])
])

// 使用导航 composable
const {
  selectedRow,
  selectedCol,
  selectedItem,
  handleKeydown: handleNavigationKeydown,
  resetSelection
} = useNavigation(searchMode, navigationGrid)

const selectedQuickType = computed(() => navigationGrid.value[selectedRow.value]?.type)

/**
 * Hand the current quick calculation to the calculation paper plugin, which appends it as a row
 * of the open paper so further steps can continue there.
 * @returns Completes after launching the plugin, or marks the plugin as missing.
 */
async function continueInCalculationPaper(): Promise<void> {
  const expression = calculation.value?.expression
  if (!expression) return
  const command = findCalculationPaperCommand(commandDataStore.regexCommands)
  if (!command) {
    paperContinueMissing.value = true
    return
  }
  try {
    await window.ztools.launch({
      path: command.path,
      type: 'plugin',
      featureCode: command.featureCode,
      name: command.name,
      cmdType: 'regex',
      param: {
        payload: expression,
        type: 'regex',
        inputState: {
          searchQuery: props.searchQuery,
          pastedImage: null,
          pastedFiles: null,
          pastedText: null
        }
      }
    })
  } catch (error) {
    console.error('打开计算稿纸失败:', error)
  }
}

/**
 * Copy the selected built-in result without launching a plugin or dismissing the panel.
 * @param kind Built-in row kind.
 * @returns Completes after clipboard write or opening provider configuration.
 */
async function activateQuickResult(kind: string): Promise<void> {
  const translation = kind.startsWith('quickTranslation:')
    ? windowStore.translations.find((row) => 'quickTranslation:' + row.providerId === kind)
    : undefined
  if (translation?.needsConfiguration) {
    window.ztools.openTranslationSettings()
    return
  }
  const text =
    kind === 'quickCalculation'
      ? calculation.value?.copyText
      : translation && !translation.loading && !translation.error
        ? translation.text
        : ''
  if (!text) return
  try {
    await window.ztools.copyToClipboard(text)
    copiedKind.value = kind
  } catch {
    copiedKind.value = ''
  }
}

// 列表模式的选中索引（一维索引）
const listModeSelectedIndex = computed(() => {
  if (searchMode.value !== 'list') {
    return -1
  }

  const grid = navigationGrid.value
  if (grid.length === 0 || selectedRow.value >= grid.length) {
    return -1
  }

  // 计算一维索引
  let index = 0
  for (let i = 0; i < selectedRow.value; i++) {
    index += grid[i].items.length
  }
  index += selectedCol.value

  return /^(quick|file)/.test(selectedQuickType.value || '')
    ? -1
    : index - (calculation.value ? 1 : 0)
})

// 监听搜索内容变化,重置选中状态和折叠状态
watch(
  [
    () => props.searchQuery,
    () => props.pastedImage,
    () => props.pastedText,
    () => props.pastedFiles
  ],
  () => {
    resetSelection()
    // 重置所有折叠状态
    isRecentExpanded.value = false
    isPinnedExpanded.value = false
    isSearchResultsExpanded.value = false
    isBestMatchesExpanded.value = false
    isRecommendationsExpanded.value = false
    filesExpanded.value = false
    clearFileNotice()
    hideError.value = ''
    emit('height-changed')
  }
)

// 监听折叠状态变化，通知父组件调整窗口高度
watch(
  [
    isRecentExpanded,
    isPinnedExpanded,
    isSearchResultsExpanded,
    isBestMatchesExpanded,
    isRecommendationsExpanded,
    filesExpanded,
    mainFileQuery,
    fileItems,
    filesLoading,
    fileMessage
  ],
  () => {
    emit('height-changed')
  }
)

/**
 * Scroll the selected app, quick result or inline file control into the shared viewport.
 * @returns No return value.
 */
function scrollToSelectedItem(): void {
  const container = scrollContainerRef.value
  if (!container) {
    return
  }

  nextTick(() => {
    let selectedElement: HTMLElement | null = container.querySelector(
      '.quick-result.selected, .main-file-preview .selected'
    )

    // 列表模式：查找 .list-item.selected
    if (!selectedElement && searchMode.value === 'list') {
      const listItems = container.querySelectorAll('.list-item.selected')
      if (listItems && listItems.length > 0) {
        selectedElement = listItems[0] as HTMLElement
      }
    } else if (!selectedElement) {
      // 聚合模式：查找 .app-item.selected
      const appItems = container.querySelectorAll('.app-item.selected')
      if (appItems && appItems.length > 0) {
        selectedElement = appItems[0] as HTMLElement
      }
    }

    if (!selectedElement) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = selectedElement.getBoundingClientRect()

    // 检查是否在可见区域内
    const isAbove = targetRect.top < containerRect.top
    const isBelow = targetRect.bottom > containerRect.bottom

    if (isAbove) {
      const scrollTop = container.scrollTop + (targetRect.top - containerRect.top)
      setTimeout(() => {
        container.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'auto'
        })
      }, 50)
    } else if (isBelow) {
      const scrollTop = container.scrollTop + (targetRect.bottom - containerRect.bottom)
      setTimeout(() => {
        container.scrollTo({
          top: scrollTop,
          behavior: 'auto'
        })
      }, 50)
    }
  })
}

// 监听选中项变化，自动滚动
watch([selectedRow, selectedCol], () => {
  scrollToSelectedItem()
})

// 监听 mainPush 结果变化，调整窗口高度
watch(
  () => mainPushGroups.value,
  () => {
    emit('height-changed')
  },
  { deep: true }
)

// 翻译结果和搜索范围变更会改变内容高度，无需用户再次输入。
watch(
  [() => windowStore.translations, () => windowStore.searchSources, calculation],
  () => emit('height-changed'),
  { deep: true, flush: 'post' }
)

// 监听固定列表变化，调整窗口高度
watch(
  () => pinnedApps.value.length,
  () => {
    emit('height-changed')
  }
)

// 监听历史记录列表变化，调整窗口高度
watch(
  () => displayApps.value.length,
  () => {
    emit('height-changed')
  }
)

/**
 * 根据结果来源构建应用右键菜单。
 * @param app 触发菜单的指令
 * @param source 结果所在区域
 * @returns 菜单展示完成后结束的 Promise
 */
async function handleAppContextMenu(app: any, source: ContextMenuSource = 'search'): Promise<void> {
  const menuItems: any[] = []
  if ((app.type === 'app' || app.type === 'direct') && source !== 'recommendation') {
    menuItems.push({
      id: `hide-search-app:${JSON.stringify({ paths: [app.targetPath || app.path, app.path] })}`,
      label: '从搜索结果中隐藏'
    })
  }

  // 只在历史记录中显示"从使用记录删除"
  if (source === 'history') {
    const historyMatchName =
      app.type === 'plugin'
        ? app.pluginName || app.name
        : app.type === 'direct' && app.subType === 'app'
          ? app.persistedName || app.name
          : app.name
    menuItems.push({
      id: `remove-from-history:${JSON.stringify({
        path: app.path,
        featureCode: app.featureCode,
        name: historyMatchName
      })}`,
      label: '从使用记录删除'
    })
  }

  // 如果是应用（不是插件和系统设置，且不是协议链接），显示"打开文件位置"
  const isProtocolLink = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(app.path) && !app.path.includes('\\')
  const isLocalApp =
    app.type !== 'system-setting' && app.type !== 'plugin' && app.path && !isProtocolLink
  if (isLocalApp) {
    menuItems.push({
      id: `reveal-in-finder:${JSON.stringify({ path: app.path })}`,
      label: '打开文件位置'
    })
  }

  // Windows 本地应用显示"以管理员身份运行"
  if (isLocalApp && window.ztools.getPlatform() === 'win32') {
    menuItems.push({
      id: `launch-as-admin:${JSON.stringify({ path: app.path, name: app.name })}`,
      label: '以管理员身份运行'
    })
  }

  if (source === 'recommendation') {
    // 推荐区使用独立置顶序列，与主搜索框固定列表完全隔离。
    const recommendationIndex = getRecommendationPinIndex(app)
    if (recommendationIndex >= 0) {
      menuItems.push({
        id: `unpin-recommendation:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '取消置顶'
      })
      menuItems.push({
        id: `move-recommendation-to-front:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '排到最前',
        enabled: recommendationIndex > 0
      })
    } else {
      menuItems.push({
        id: `pin-recommendation:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: app.name,
          pluginName: app.pluginName,
          type: app.type
        })}`,
        label: '置顶'
      })
    }

    // 匹配推荐使用专属菜单，不追加超级面板、插件设置和快捷键等通用操作。
    await window.ztools.showContextMenu(menuItems)
    return
  } else {
    // 其他区域继续使用原有的主搜索框固定逻辑。
    const fixedMatchName =
      app.type === 'plugin'
        ? app.pluginName || app.name
        : app.type === 'direct' && app.subType === 'app'
          ? app.persistedName || app.name
          : app.name
    if (isPinned(app.path, app.featureCode, fixedMatchName)) {
      menuItems.push({
        id: `unpin-app:${JSON.stringify({
          path: app.path,
          featureCode: app.featureCode,
          name: fixedMatchName
        })}`,
        label: '从搜索框取消固定'
      })
    } else {
      menuItems.push({
        id: `pin-app:${JSON.stringify({
          name:
            app.type === 'direct' && app.subType === 'app'
              ? app.persistedName || app.name
              : app.name,
          path: app.path,
          icon: app.icon,
          pinyin: app.pinyin,
          pinyinAbbr: app.pinyinAbbr,
          type: app.type,
          featureCode: app.featureCode,
          pluginName: app.pluginName,
          pluginExplain: app.pluginExplain,
          subType: app.subType,
          cmdType: app.cmdType,
          originalName: app.originalName,
          persistedName: app.persistedName
        })}`,
        label: '固定到搜索框'
      })
    }
  }

  // 超级面板固定/取消固定
  if (isPinnedToSuperPanel(app)) {
    menuItems.push({
      id: `unpin-super-panel:${JSON.stringify({ path: app.path, featureCode: app.featureCode })}`,
      label: '从超级面板取消固定'
    })
  } else {
    menuItems.push({
      id: `pin-super-panel:${JSON.stringify({
        name: app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        featureCode: app.featureCode,
        pluginName: app.pluginName,
        pluginExplain: app.pluginExplain,
        cmdType: app.cmdType
      })}`,
      label: '固定到超级面板'
    })
  }

  // 如果是插件，添加插件设置菜单
  if (app.type === 'plugin' && app.pluginName) {
    let outKillPlugins: string[] = []
    let autoDetachPlugins: string[] = []
    try {
      const killData = await window.ztools.dbGet('out-kill-plugin')
      outKillPlugins = normalizeConfigList(killData)
      const detachData = await window.ztools.dbGet('auto-detach-plugin')
      autoDetachPlugins = normalizeConfigList(detachData)
    } catch (error) {
      console.log('读取配置失败:', error)
    }

    const pluginPayload = getPluginPayload(app)
    const isAutoKill = !!pluginPayload && outKillPlugins.includes(pluginPayload.pluginName)
    const isAutoDetach = !!pluginPayload && autoDetachPlugins.includes(pluginPayload.pluginName)
    const mainPushState = await resolveMainPushMenuState(pluginPayload?.pluginName)

    menuItems.push({
      label: '插件设置',
      submenu: [
        ...(mainPushState.supported
          ? [
              {
                id: `toggle-main-push:${JSON.stringify(pluginPayload)}`,
                label: '搜索栏推送',
                type: 'checkbox',
                checked: mainPushState.enabled
              }
            ]
          : []),
        {
          id: `toggle-auto-kill:${JSON.stringify(pluginPayload)}`,
          label: '退出到后台立即结束运行',
          type: 'checkbox',
          checked: isAutoKill
        },
        {
          id: `toggle-auto-detach:${JSON.stringify(pluginPayload)}`,
          label: '自动分离为独立窗口',
          type: 'checkbox',
          checked: isAutoDetach
        }
      ]
    })

    menuItems.push({
      id: `view-plugin-detail:${JSON.stringify(pluginPayload)}`,
      label: '查看插件详情'
    })
  }

  // 添加更多菜单
  menuItems.push({
    label: '更多',
    submenu: [
      {
        id: `add-global-shortcut:${JSON.stringify({ name: app.name, pluginTitle: app.pluginTitle || app.pluginName })}`,
        label: '设置全局快捷键'
      }
    ]
  })

  await window.ztools.showContextMenu(menuItems)
}

// 选择应用
async function handleSelectApp(app: any): Promise<void> {
  try {
    // 如果是"上次匹配"指令，执行恢复逻辑
    if (app.path === 'special:last-match') {
      const state = await window.ztools.restoreLastMatch()
      if (state) {
        emit('restore-match', state)
      }
      return
    }

    // 记录搜索偏好（仅普通文本搜索时，排除匹配指令类型）
    if (props.searchQuery.trim() && (!app.cmdType || app.cmdType === 'text')) {
      saveSearchPreference(parseSearchScope(props.searchQuery).query, app)
    }

    // 构造 payload 和 type
    let payload: any = parseSearchScope(props.searchQuery).query
    let type = app.cmdType || 'text'

    if (app.cmdType === 'img' && props.pastedImage) {
      payload = props.pastedImage
    } else if (app.cmdType === 'over' && props.pastedText) {
      payload = props.pastedText
    } else if (app.cmdType === 'regex' && props.pastedText) {
      payload = props.pastedText
    } else if (app.cmdType === 'files' && props.pastedFiles) {
      payload = props.pastedFiles.map((file) => ({
        isFile: !file.isDirectory,
        isDirectory: file.isDirectory,
        name: file.name,
        path: file.path
      })) as MatchFile[]
    } else if (app.cmdType === 'window') {
      if (!commandDataStore.matchesWindowCommand(app, windowStore.currentWindow)) {
        console.warn('window 指令与当前窗口不匹配，已阻止启动:', app.name)
        return
      }
      payload = JSON.parse(JSON.stringify(windowStore.currentWindow))
    }

    // 启动应用或插件
    await window.ztools.launch({
      path: app.path,
      type: app.type || 'app',
      featureCode: app.featureCode,
      name: app.name,
      cmdType: app.cmdType || 'text',
      confirmDialog: app.confirmDialog
        ? {
            type: app.confirmDialog.type,
            buttons: [...app.confirmDialog.buttons],
            defaultId: app.confirmDialog.defaultId,
            cancelId: app.confirmDialog.cancelId,
            title: app.confirmDialog.title,
            message: app.confirmDialog.message,
            detail: app.confirmDialog.detail
          }
        : undefined,
      param: {
        payload,
        type,
        inputState: {
          searchQuery: props.searchQuery,
          pastedImage: props.pastedImage,
          pastedFiles: props.pastedFiles
            ? props.pastedFiles.map((file) => ({
                isFile: !file.isDirectory,
                isDirectory: file.isDirectory,
                name: file.name,
                path: file.path
              }))
            : null,
          pastedText: props.pastedText
        }
      }
    })
  } catch (error) {
    console.error('启动失败:', error)
  }
}

// 窗口功能选择
async function handleWindowAction(item: any): Promise<void> {
  try {
    // 执行命令，将 window feature 的命令作为普通插件命令执行
    await handleSelectApp(item)
  } catch (error) {
    console.error('执行窗口操作失败:', error)
  }
}

// 选择推荐项
async function handleRecommendationSelect(item: any): Promise<void> {
  if (item.type === 'plugin') {
    await handleSelectApp(item)
  }
}

// 处理 mainPush 搜索结果选择
async function handleMainPushSelectAction(group: MainPushGroup, item: MainPushItem): Promise<void> {
  try {
    const shouldEnter = await handleMainPushSelect(group, item, props.searchQuery)
    if (shouldEnter) {
      // 构建原始 item（剔除内部展示字段）
      const rawItem = JSON.parse(JSON.stringify(toRaw(item)))
      delete rawItem._resolvedIcon
      // 进入插件
      await window.ztools.launch({
        path: group.pluginPath,
        type: 'plugin',
        featureCode: group.featureCode,
        name: group.featureExplain || group.pluginName,
        cmdType: group.matchedCmdType,
        param: {
          payload: parseSearchScope(props.searchQuery).query,
          type: group.matchedCmdType,
          from: 'main',
          option: rawItem
        }
      })
    }
  } catch (error) {
    console.error('mainPush 选择处理失败:', error)
  }
}

// 点击 mainPush 标题行，直接进入插件应用
async function handleEnterMainPushApp(group: MainPushGroup): Promise<void> {
  try {
    await window.ztools.launch({
      path: group.pluginPath,
      type: 'plugin',
      featureCode: group.featureCode,
      name: group.featureExplain || group.pluginName,
      cmdType: group.matchedCmdType,
      param: {
        payload: parseSearchScope(props.searchQuery).query,
        type: group.matchedCmdType,
        from: 'main'
      }
    })
  } catch (error) {
    console.error('mainPush 进入应用失败:', error)
  }
}

/**
 * Navigate results; Enter continues a calculation in paper and Ctrl+Enter copies its value.
 * @param event Keyboard event forwarded by the main search input.
 * @returns Resolves after the selected action is handled.
 */
async function handleKeydown(event: KeyboardEvent): Promise<void> {
  const grid = navigationGrid.value
  if (!grid || grid.length === 0) return

  if (selectedQuickType.value?.startsWith('file')) {
    if (event.key === 'Enter' || (event.key === ' ' && windowStore.spaceOpenCommand)) {
      event.preventDefault()
      if (selectedQuickType.value === 'fileToggle') toggleFiles()
      else if (selectedQuickType.value === 'fileMore') emit('enter-file-search')
      else if (selectedItem.value)
        await openFile(selectedItem.value, event.ctrlKey || event.metaKey)
      return
    }
    if (
      selectedQuickType.value === 'fileItem' &&
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 'c'
    ) {
      event.preventDefault()
      await copyPath(selectedItem.value)
      return
    }
  }

  // 处理 Enter 键的特殊逻辑
  if (event.key === 'Enter') {
    event.preventDefault()
    const item = selectedItem.value
    if (item) {
      const currentRow = grid[selectedRow.value]
      if (currentRow.type === 'quickCalculation' && !event.ctrlKey && !event.metaKey) {
        await continueInCalculationPaper()
      } else if (currentRow.type.startsWith('quick')) {
        await activateQuickResult(currentRow.type)
      } else if (currentRow.type === 'window') {
        handleWindowAction(item)
      } else if (currentRow.type === 'recommendation') {
        handleRecommendationSelect(item)
      } else if (currentRow.type?.startsWith('mainPush:') && currentRow.mainPushGroup) {
        handleMainPushSelectAction(currentRow.mainPushGroup, item)
      } else {
        handleSelectApp(item)
      }
    }
    return
  }

  // 处理空格键的特殊逻辑（开启了空格打开指令时）
  if (event.key === ' ' && windowStore.spaceOpenCommand) {
    event.preventDefault()
    const item = selectedItem.value
    if (item) {
      const currentRow = grid[selectedRow.value]
      if (currentRow.type.startsWith('quick')) {
        await activateQuickResult(currentRow.type)
      } else if (currentRow.type === 'window') {
        handleWindowAction(item)
      } else if (currentRow.type === 'recommendation') {
        handleRecommendationSelect(item)
      } else if (currentRow.type?.startsWith('mainPush:') && currentRow.mainPushGroup) {
        handleMainPushSelectAction(currentRow.mainPushGroup, item)
      } else {
        handleSelectApp(item)
      }
    }
    return
  }

  // 其他导航键交给 useNavigation 处理
  handleNavigationKeydown(event, () => {
    // 这个回调不会被调用，因为 Enter 键已经在上面处理了
  })
}

/**
 * 执行主进程右键菜单回传的命令。
 * @param command 菜单命令及其序列化参数
 * @returns 命令处理完成后结束的 Promise
 */
async function handleContextMenuCommand(command: string): Promise<void> {
  if (command.startsWith('hide-search-app:')) {
    hideError.value = ''
    try {
      const { paths } = JSON.parse(command.slice('hide-search-app:'.length))
      await window.ztools.hideSearchResult('app', paths)
    } catch {
      hideError.value = '隐藏失败，请重试'
    }
    emit('focus-input')
    return
  }
  if (await handleFileMenuCommand(command)) return
  // 文件行的菜单（打开、打开所在文件夹、复制路径）由文件操作统一处理。
  if (command.startsWith('remove-from-history:')) {
    const jsonStr = command.replace('remove-from-history:', '')
    try {
      const { path, featureCode, name } = JSON.parse(jsonStr)
      await removeFromHistory(path, featureCode, name)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('从历史记录删除失败:', error)
    }
  } else if (command.startsWith('pin-recommendation:')) {
    const jsonStr = command.replace('pin-recommendation:', '')
    try {
      await pinRecommendation(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('置顶匹配推荐失败:', error)
    }
  } else if (command.startsWith('unpin-recommendation:')) {
    const jsonStr = command.replace('unpin-recommendation:', '')
    try {
      await unpinRecommendation(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('取消匹配推荐置顶失败:', error)
    }
  } else if (command.startsWith('move-recommendation-to-front:')) {
    const jsonStr = command.replace('move-recommendation-to-front:', '')
    try {
      await moveRecommendationToFront(JSON.parse(jsonStr))
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('调整匹配推荐顺序失败:', error)
    }
  } else if (command.startsWith('pin-app:')) {
    const appJson = command.replace('pin-app:', '')
    try {
      const app = JSON.parse(appJson)
      await pinCommand(app)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('固定应用失败:', error)
    }
  } else if (command.startsWith('unpin-app:')) {
    const jsonStr = command.replace('unpin-app:', '')
    try {
      const { path, featureCode, name } = JSON.parse(jsonStr)
      await unpinCommand(path, featureCode, name)
      nextTick(() => {
        emit('height-changed')
        emit('focus-input')
      })
    } catch (error) {
      console.error('取消固定失败:', error)
    }
  } else if (command.startsWith('reveal-in-finder:')) {
    const jsonStr = command.replace('reveal-in-finder:', '')
    try {
      const { path: filePath } = JSON.parse(jsonStr)
      await window.ztools.revealInFinder(filePath)
      emit('focus-input')
    } catch (error) {
      console.error('打开文件位置失败:', error)
    }
  } else if (command.startsWith('launch-as-admin:')) {
    const jsonStr = command.replace('launch-as-admin:', '')
    try {
      const { path: appPath, name } = JSON.parse(jsonStr)
      await window.ztools.launchAsAdmin(appPath, name)
    } catch (error) {
      console.error('管理员启动失败:', error)
    }
  } else if (command.startsWith('toggle-auto-kill:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-auto-kill:', ''))
    try {
      let outKillPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('out-kill-plugin')
        outKillPlugins = normalizeConfigList(data)
      } catch (error) {
        console.debug('未找outKillPlugin配置', error)
      }

      if (!pluginPayload) {
        return
      }

      const { pluginName } = pluginPayload
      outKillPlugins = outKillPlugins.includes(pluginName)
        ? outKillPlugins.filter((n) => n !== pluginName)
        : [...outKillPlugins, pluginName]
      await window.ztools.dbPut('out-kill-plugin', outKillPlugins)
      console.log('已更新 outKillPlugin 配置:', outKillPlugins)
    } catch (error: any) {
      console.error('切换自动结束配置失败:', error)
    }
  } else if (command.startsWith('view-plugin-detail:')) {
    const pluginPayload = parsePluginPayload(command.replace('view-plugin-detail:', ''))
    try {
      // 从 commandDataStore 中查找设置插件（已安装插件功能）的路径
      const settingCmd = commandDataStore.commands.find(
        (c) =>
          c.type === 'plugin' &&
          c.pluginName === 'setting' &&
          c.featureCode === 'ui.router?router=Plugins'
      )
      if (settingCmd) {
        await window.ztools.launch({
          path: settingCmd.path,
          type: 'plugin',
          featureCode: 'ui.router?router=Plugins',
          name: '已安装插件',
          cmdType: 'text',
          param: {
            payload: pluginPayload ? pluginPayload.pluginName : '',
            type: 'text'
          }
        })
      } else {
        console.error('未找到设置插件的已安装插件指令')
      }
    } catch (error) {
      console.error('查看插件详情失败:', error)
    }
  } else if (command.startsWith('toggle-auto-detach:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-auto-detach:', ''))
    try {
      let autoDetachPlugins: string[] = []
      try {
        const data = await window.ztools.dbGet('auto-detach-plugin')
        autoDetachPlugins = normalizeConfigList(data)
      } catch (error) {
        console.debug('未找到 autoDetachPlugin 配置', error)
      }

      if (!pluginPayload) {
        return
      }

      const { pluginName } = pluginPayload
      autoDetachPlugins = autoDetachPlugins.includes(pluginName)
        ? autoDetachPlugins.filter((n) => n !== pluginName)
        : [...autoDetachPlugins, pluginName]
      await window.ztools.dbPut('auto-detach-plugin', autoDetachPlugins)
      console.log('已更新 autoDetachPlugin 配置:', autoDetachPlugins)
    } catch (error: any) {
      console.error('切换自动分离配置失败:', error)
    }
  } else if (command.startsWith('toggle-main-push:')) {
    const pluginPayload = parsePluginPayload(command.replace('toggle-main-push:', ''))
    try {
      await toggleMainPushSetting(pluginPayload?.pluginName)
    } catch (error: any) {
      console.error('切换搜索栏推送配置失败:', error)
    }
  } else if (command.startsWith('pin-super-panel:')) {
    const appJson = command.replace('pin-super-panel:', '')
    try {
      const app = JSON.parse(appJson)
      await window.ztools.pinToSuperPanel(app)
      await loadSuperPanelPinnedData()
    } catch (error) {
      console.error('固定到超级面板失败:', error)
    }
  } else if (command.startsWith('unpin-super-panel:')) {
    const jsonStr = command.replace('unpin-super-panel:', '')
    try {
      const { path, featureCode } = JSON.parse(jsonStr)
      await window.ztools.unpinSuperPanelCommand(path, featureCode)
      await loadSuperPanelPinnedData()
    } catch (error) {
      console.error('从超级面板取消固定失败:', error)
    }
  } else if (command.startsWith('add-global-shortcut:')) {
    const jsonStr = command.replace('add-global-shortcut:', '')
    try {
      const { name, pluginTitle } = JSON.parse(jsonStr)
      // 构建目标指令字符串（使用插件标题/指令名称格式）
      const targetCommand = pluginTitle ? `${pluginTitle}/${name}` : name

      // 找到设置插件的快捷键指令
      const settingCmd = commandDataStore.commands.find(
        (c) =>
          c.type === 'plugin' &&
          c.pluginName === 'setting' &&
          c.featureCode === 'ui.router?router=Shortcuts'
      )
      console.log('targetCommand', targetCommand)
      if (settingCmd) {
        await window.ztools.launch({
          path: settingCmd.path,
          type: 'plugin',
          featureCode: 'ui.router?router=Shortcuts',
          name: '快捷键',
          cmdType: 'text',
          param: {
            payload: targetCommand
          }
        })
      } else {
        console.error('未找到设置插件的快捷键指令')
      }
    } catch (error) {
      console.error('添加全局快捷键失败:', error)
    }
  }
}

// 点击容器聚焦输入框
function handleContainerClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.app-item')) {
    return
  }
  emit('focus-input')
}

/**
 * Restore every section to its default collapsed state on a new search session.
 * @returns No return value.
 */
function resetCollapseState(): void {
  filesExpanded.value = false
  clearFileNotice()
  isRecentExpanded.value = false
  isPinnedExpanded.value = false
  isSearchResultsExpanded.value = false
  isBestMatchesExpanded.value = false
  isRecommendationsExpanded.value = false
}

// 初始化
let cleanupContextMenuListener: (() => void) | null = null

onMounted(() => {
  // 先清理之前可能残留的监听器
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = window.ztools.onContextMenuCommand(handleContextMenuCommand)
})

onUnmounted(() => {
  cleanupContextMenuListener?.()
  cleanupContextMenuListener = null
})

// 导出方法供父组件调用
defineExpose({
  navigationGrid,
  handleKeydown,
  resetSelection,
  resetCollapseState
})
</script>

<style scoped>
.scrollable-content {
  max-height: 541px;
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none;
  padding: 0 0 2px 0;
  border-radius: 0;
}

.list-mode-results {
  display: flex;
  flex-direction: column;
}
.main-file-preview {
  margin: 4px 12px 0;
}
.file-fold,
.file-page-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 24px;
  gap: 10px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.file-fold::before,
.file-fold::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border-color, #8883);
  opacity: 0.6;
}
.file-fold svg,
.file-page-link svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.file-fold.expanded svg {
  transform: rotate(180deg);
}
.file-fold:hover,
.file-page-link:hover {
  background: var(--hover-bg);
}
.file-fold.selected,
.file-page-link.selected {
  background: var(--primary-light-bg);
}
.file-fold:focus-visible,
.file-page-link:focus-visible {
  outline: 1px solid var(--primary-color);
}
.file-preview-hint {
  margin: 12px 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>

<style scoped>
.translation-provider {
  font-style: normal;
  font-size: 11px;
  opacity: 0.65;
  margin-right: 6px;
}
.search-translation {
  margin: 12px 16px;
  padding: 14px;
  border: 1px solid var(--border-color, #aaa5);
  border-radius: 10px;
  user-select: text;
}
.search-translation p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-bottom: 0;
}
</style>

<style scoped>
.quick-result {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  width: 100%;
  box-sizing: border-box;
  padding: 12px 16px;
  margin: 4px 0;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--text-color);
  background: transparent;
  cursor: pointer;
}
.quick-result.selected {
  background: var(--hover-bg, #8882);
  border-color: var(--primary-color, #5088ff);
}
.quick-result svg {
  width: 26px;
  height: 26px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}
.quick-result span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.quick-result strong {
  display: block;
  font-size: 16px;
  font-weight: 500;
}
.quick-result small {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.7;
}
</style>
