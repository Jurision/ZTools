<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { normalizeQuickSearchSettings } from '@shared/quickSearchSettings'
import { normalizeSearchSources } from '@shared/searchSources'

const quick = ref(normalizeQuickSearchSettings())
const preferences = ref(normalizeSearchSources())
const hiddenNames = ref(preferences.value.hiddenApplicationNames.join('\n'))
const status = ref('')
const saving = ref(false)

/**
 * Load persisted search sources without changing any other preferences.
 * @returns Completes after loading the current profile.
 */
async function load(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet('settings-general')
    preferences.value = normalizeSearchSources(data?.searchSources)
    quick.value = normalizeQuickSearchSettings(data?.quickSearch)
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
    preferences.value = value
    status.value = '已保存，搜索范围立即生效。'
  } catch {
    status.value = '保存失败，请重试。'
  } finally {
    saving.value = false
  }
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
      符合规则的文本会在停顿 400ms
      后发送到所选翻译服务。软件名、算式、路径、网址和疑似密钥不自动发送。
      <strong>Ctrl+Shift+T</strong> 可显式翻译；在「提供商 → 翻译」填写密钥。
    </p>
    <div class="source-options">
      <label><input v-model="quick.autoCalculate" type="checkbox" />输入时自动计算</label>
      <label><input v-model="quick.autoTranslate" type="checkbox" />输入时自动翻译</label>
    </div>
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
[role='status'] {
  margin-left: 12px;
  font-size: 13px;
}
</style>
