<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { normalizeQuickSearchSettings } from '@shared/quickSearchSettings'
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
    const value = normalizeSearchSources({
      ...preferences.value,
      hiddenApplicationNames: hiddenNames.value.split('\n')
    })
    await window.ztools.internal.updateSearchSources(value)
    await window.ztools.internal.updateQuickSearchSettings(quick.value)
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
      默认只搜索应用。输入 <strong>&gt; 关键词</strong> 可临时搜索全部指令；Ctrl+,
      打开设置。超级面板固定按钮不受影响。
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
      打字时不会自动翻译：快速连按两下<strong>空格</strong>（或
      <strong>Ctrl+Shift+T</strong>）才翻译当前输入。
      自己粘贴进空搜索框的文字块会自动翻译，网址、路径和疑似密钥不发送。
      填好密钥的服务（有道、OpenAI）会同时各显示一行结果；在「提供商 → 翻译」填写密钥。
    </p>
    <div class="source-options">
      <label><input v-model="quick.autoCalculate" type="checkbox" />输入时自动计算</label>
      <label><input v-model="quick.autoTranslate" type="checkbox" />粘贴文字时自动翻译</label>
    </div>
    <h3 id="file-search-title">硬盘文件搜索</h3>
    <p>
      在软件结果后面显示最多 5 条硬盘上的文件和文件夹（由本机的 Everything
      提供，只搜名字，不搜文件内容）。输入 <strong>f 关键词</strong>
      或点「更多文件结果」进入文件搜索专页，可切换精确/模糊、按类型筛选、按最近修改排序。
    </p>
    <div class="source-options">
      <label
        ><input
          v-model="fileSearch.enabled"
          type="checkbox"
          data-setting="file-search-enabled"
        />在主搜索框显示硬盘文件结果</label
      >
    </div>
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
