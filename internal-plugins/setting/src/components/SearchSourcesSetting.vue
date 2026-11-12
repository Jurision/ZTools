<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { normalizeQuickSearchSettings } from '@shared/quickSearchSettings'
import {
  normalizeSearchTriggers,
  searchShortcutFromEvent,
  validateSearchTriggers,
  type SearchAction
} from '@shared/searchTriggers'
import { normalizeSearchSources } from '@shared/searchSources'
import { DEFAULT_FILE_SEARCH_EXCLUDES, normalizeFileSearchSettings } from '@shared/fileSearch'

const quick = ref(normalizeQuickSearchSettings())
const fileSearch = ref(normalizeFileSearchSettings())
const fileExcludes = ref(fileSearch.value.excludes.join('\n'))
const preferences = ref(normalizeSearchSources())
const hiddenNames = ref(preferences.value.hiddenApplicationNames.join('\n'))
const status = ref('')
const saving = ref(false)
const clearingHistory = ref(false)
const launcherShortcut = ref('Ctrl+Space')
const actions: { id: SearchAction; label: string }[] = [
  { id: 'translate', label: '翻译当前内容' },
  { id: 'files', label: '进入文件搜索' }
]

/**
 * Record a local modifier chord without installing keyboard hooks.
 * @param event Key event from the focused shortcut recorder.
 * @param action Action whose optional chord is being edited.
 * @returns No return value.
 */
function recordShortcut(event: KeyboardEvent, action: SearchAction): void {
  if (event.key === 'Tab') return
  event.preventDefault()
  if (event.key === 'Escape') {
    ;(event.target as HTMLInputElement).blur()
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    quick.value.triggers[action].shortcut = ''
    return
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  const shortcut = searchShortcutFromEvent(event)
  if (!shortcut) {
    status.value = '请按 Ctrl、Alt 或 Command 加字母、数字或功能键；Delete 清除。'
    return
  }
  // Validate the pair before changing it, so the other action cannot be shadowed.
  const candidate = {
    translate: { ...quick.value.triggers.translate },
    files: { ...quick.value.triggers.files }
  }
  candidate[action].shortcut = shortcut
  const error = validateSearchTriggers(candidate, launcherShortcut.value)
  if (error) {
    status.value = error
    return
  }
  quick.value.triggers = candidate
  status.value = '快捷键已填入，点击保存后生效。'
}

/**
 * Restore the standard repeated-Space and translation chord bindings in the editor.
 * @returns No return value.
 */
function restoreDefaultTriggers(): void {
  quick.value.triggers = normalizeSearchTriggers()
  status.value = '已恢复默认快捷键，点击保存后生效。'
}

/**
 * Clear device-local successful-open statistics without deleting files.
 * @returns Completes after the settings API confirms the clear.
 */
async function clearFileHistory(): Promise<void> {
  if (clearingHistory.value) return
  clearingHistory.value = true
  try {
    await window.ztools.internal.clearFileSearchHistory()
    status.value = '打开记录已清除，文件未改动。'
  } catch {
    status.value = '清除失败，请重试。'
  } finally {
    clearingHistory.value = false
  }
}

/**
 * Load persisted search sources without changing any other preferences.
 * @returns Completes after loading the current profile.
 */
async function load(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet('settings-general')
    launcherShortcut.value = data?.hotkey || 'Ctrl+Space'
    preferences.value = normalizeSearchSources(data?.searchSources)
    quick.value = normalizeQuickSearchSettings(data?.quickSearch)
    fileSearch.value = normalizeFileSearchSettings(data?.fileSearch)
    fileExcludes.value = fileSearch.value.excludes.join('\n')
    hiddenNames.value = preferences.value.hiddenApplicationNames.join('\n')
  } catch {
    status.value = '读取失败，请重新打开设置。'
  }
}

/**
 * Persist explicit source choices and refresh only the main search renderer.
 * @returns Completes after persistence and notification.
 */
async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  status.value = ''
  try {
    // The launcher can change elsewhere in this settings view after this component mounts.
    const current = await window.ztools.internal.dbGet('settings-general')
    launcherShortcut.value = current?.hotkey || 'Ctrl+Space'
    const error = validateSearchTriggers(quick.value.triggers, launcherShortcut.value)
    if (error) {
      status.value = error
      return
    }
    const value = normalizeSearchSources({
      ...preferences.value,
      hiddenApplicationNames: hiddenNames.value.split('\n')
    })
    await window.ztools.internal.updateSearchSources(value)
    const quickSettings = normalizeQuickSearchSettings(quick.value)
    await window.ztools.internal.updateQuickSearchSettings(quickSettings)
    quick.value = quickSettings
    // One excluded folder fragment per line; an empty list is allowed and searches everything.
    const files = normalizeFileSearchSettings({
      enabled: fileSearch.value.enabled,
      excludes: fileExcludes.value.split('\n')
    })
    await window.ztools.internal.updateFileSearchSettings(files)
    fileSearch.value = files
    fileExcludes.value = files.excludes.join('\n')
    preferences.value = value
    status.value = '已保存，搜索范围立即生效。'
  } catch {
    status.value = '保存失败，请重试。'
  } finally {
    saving.value = false
  }
}

/**
 * Put the built-in excluded folders back into the editor; nothing is saved until "保存".
 * @returns No return value.
 */
function restoreDefaultExcludes(): void {
  fileExcludes.value = DEFAULT_FILE_SEARCH_EXCLUDES.join('\n')
  status.value = '已填回默认排除项，点击保存后生效。'
}

onMounted(load)
</script>

<template>
  <section class="search-source-settings" aria-labelledby="search-source-title">
    <h3 id="search-source-title">默认搜索范围</h3>
    <p>
      默认展示应用和运算结果，硬盘文件预览收起在底部。输入
      <strong>&gt; 关键词</strong> 可临时搜索全部指令；Ctrl+, 打开设置。超级面板固定按钮不受影响。
    </p>
    <div class="source-options">
      <label><input v-model="preferences.systemSettings" type="checkbox" />系统设置</label>
      <label><input v-model="preferences.files" type="checkbox" />文件与其他本地启动项</label>
      <label><input v-model="preferences.plugins" type="checkbox" />插件功能与匹配推荐</label>
    </div>
    <label for="hidden-app-names">普通搜索中隐藏的应用名称（每行一个）</label>
    <textarea id="hidden-app-names" v-model="hiddenNames" rows="4" spellcheck="false"></textarea>
    <p>
      删除某一行可恢复该应用；Global Flags
      的不同架构入口一起隐藏。右键应用还可使用已有的禁用指令管理功能。
    </p>
    <p>
      输入和粘贴不会自动翻译，只有主动触发下面的翻译快捷键才执行。文件预览只查询本机索引。
      翻译会把当前内容发送给已配置的服务；网址、路径和疑似密钥不发送。
      填好密钥的服务（有道、OpenAI）会同时各显示一行结果；在「提供商 → 翻译」填写密钥。
    </p>
    <div class="source-options">
      <label><input v-model="quick.autoCalculate" type="checkbox" />输入时自动计算</label>
    </div>
    <h3>搜索框快捷键</h3>
    <p>
      仅在主搜索框生效，不占用其他应用的快捷键。两种动作可分别设置空格次数和组合键。
      组合键框点击后直接按键，Delete 清除；文件专页内空格只用于分词。
    </p>
    <div v-for="action in actions" :key="action.id" class="trigger-row">
      <strong>{{ action.label }}</strong>
      <label>
        空格触发
        <select
          v-model="quick.triggers[action.id].spaceCount"
          :data-setting="`${action.id}-space-count`"
        >
          <option :value="0">关闭</option>
          <option :value="2">快速连按两下</option>
          <option :value="3">快速连按三下</option>
        </select>
      </label>
      <label>
        组合键
        <input
          :value="quick.triggers[action.id].shortcut"
          :data-setting="`${action.id}-shortcut`"
          :aria-label="`${action.label}组合键`"
          type="text"
          readonly
          placeholder="点击后按组合键"
          @keydown="recordShortcut($event, action.id)"
        />
      </label>
      <button
        type="button"
        :aria-label="`清除${action.label}组合键`"
        @click="quick.triggers[action.id].shortcut = ''"
      >
        清除
      </button>
    </div>
    <button
      type="button"
      class="link-button"
      data-setting="reset-search-triggers"
      @click="restoreDefaultTriggers"
    >
      恢复默认快捷键
    </button>
    <h3 id="file-search-title">硬盘文件搜索</h3>
    <label><input v-model="fileSearch.enabled" type="checkbox" />主搜索框显示折叠文件预览</label>
    <p>
      输入后，主框底部的小箭头可展开最多 6
      条文件结果，每次重新搜索默认收起。用文件搜索快捷键或预览底部箭头进入专页，也可手动输入
      <strong>f 关键词</strong>。专页可切换精确/模糊、类型筛选和排序。 结果由本机 Everything
      提供，只搜名字和路径，不搜文件内容。
    </p>
    <label for="file-search-excludes">不搜索这些文件夹（每行一个路径片段，不区分大小写）</label>
    <p>
      常用文件在相同匹配档内优先，只在本机保存最近 500 条打开记录。
      <button
        type="button"
        data-setting="clear-file-search-history"
        :disabled="clearingHistory"
        @click="clearFileHistory"
      >
        清除打开记录
      </button>
    </p>
    <textarea
      id="file-search-excludes"
      v-model="fileExcludes"
      rows="6"
      spellcheck="false"
    ></textarea>
    <p>
      路径里只要包含某一行就不显示。例如 <strong>\node_modules\</strong> 排除所有同名文件夹，<strong
        >:\Windows\</strong
      >
      排除各盘根目录下的 Windows 文件夹，<strong>D:\备份\</strong>
      只排除这一个文件夹。默认排除系统目录、软件数据和缓存、回收站。
      <button type="button" class="link-button" @click="restoreDefaultExcludes">
        恢复默认排除项
      </button>
    </p>
    <button type="button" :disabled="saving" @click="save">
      {{ saving ? '保存中…' : '保存搜索范围' }}
    </button>
    <span role="status">{{ status }}</span>
  </section>
</template>

<style scoped>
.search-source-settings {
  margin: 16px 0;
  padding: 20px;
  border: 1px solid var(--border-color, #8884);
  border-radius: 12px;
}
h3 {
  margin: 0 0 10px;
}
p {
  opacity: 0.75;
  line-height: 1.65;
  font-size: 13px;
}
.source-options {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 16px 0;
}
.trigger-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
}
.trigger-row input,
.trigger-row select {
  margin-left: 8px;
  padding: 8px;
  border: 1px solid #8886;
  border-radius: 7px;
  color: inherit;
  background: var(--bg-color, transparent);
}
.trigger-row input {
  width: 160px;
}
label {
  font-size: 14px;
}
input {
  margin-right: 6px;
}
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 8px 0;
  padding: 10px;
  border: 1px solid #8886;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  resize: vertical;
}
button {
  padding: 8px 16px;
  border: 1px solid #8886;
  border-radius: 7px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.link-button {
  padding: 2px 8px;
  font-size: 12px;
}
h3:not(:first-child) {
  margin-top: 26px;
}
[role='status'] {
  margin-left: 12px;
  font-size: 13px;
}
</style>
