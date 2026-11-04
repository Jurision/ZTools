<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '@/components'

interface ProviderEntry {
  id: string
  type: 'translation'
  label: string
  description: string
  source: 'builtin' | 'plugin'
  pluginName?: string
  pluginPath?: string
  pluginLogo?: string
}

interface ProviderSettings {
  enabled: Partial<Record<'translation', string[]>>
  defaultId: Partial<Record<'translation', string>>
  params: Record<string, Record<string, unknown>>
}

const { success, error } = useToast()

const providers = ref<ProviderEntry[]>([])
const settings = ref<ProviderSettings>({ enabled: {}, defaultId: {}, params: {} })
const loading = ref(true)
const youdaoForm = ref({ appKey: '', appSecret: '' })
const openAiForm = ref({ baseUrl: '', apiKey: '', model: '' })
const saving = ref(false)
const quickProviderId = computed(
  () => settings.value.params['search-translation']?.providerId || 'builtin-youdao'
)

/**
 * Save entered credentials locally, optionally selecting this service for quick translation.
 * @param id Online provider identifier.
 * @param select Whether this save also selects the search translation service.
 * @returns Resolves when persistence and feedback finish; never sends a translation request.
 */
async function saveOnlineProvider(
  id: 'builtin-youdao' | 'builtin-openai-translation',
  select = false
): Promise<void> {
  saving.value = true
  try {
    const params = id === 'builtin-youdao' ? { ...youdaoForm.value } : { ...openAiForm.value }
    const result = await window.ztools.internal.providers.setParams(id, params)
    if (!result.success || !result.data) {
      error('保存翻译配置失败')
      return
    }
    settings.value = result.data
    if (select) {
      const selected = await window.ztools.internal.providers.setParams('search-translation', {
        providerId: id
      })
      if (!selected.success || !selected.data) {
        error('切换翻译服务失败')
        return
      }
      settings.value = selected.data
    }
    success(select ? '已保存并用于搜索翻译' : '翻译配置已保存')
  } catch {
    error('保存翻译配置失败')
  } finally {
    saving.value = false
  }
}

// 内置 Bergamot 引擎状态
const engineStatus = ref<'idle' | 'downloading' | 'initializing' | 'ready' | 'error'>('idle')
const engineError = ref('')
let statusTimer: ReturnType<typeof setInterval> | null = null

const enabledIds = computed(() => new Set(settings.value.enabled.translation || []))
const defaultId = computed(() => settings.value.defaultId.translation)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [allRes, setRes] = await Promise.all([
      window.ztools.internal.providers.getAll('translation'),
      window.ztools.internal.providers.getSettings()
    ])
    if (allRes.success && allRes.data) providers.value = allRes.data
    if (setRes.success && setRes.data) {
      settings.value = setRes.data
      const youdao = setRes.data.params['builtin-youdao'] || {}
      const openai = setRes.data.params['builtin-openai-translation'] || {}
      youdaoForm.value = {
        appKey: String(youdao.appKey || ''),
        appSecret: String(youdao.appSecret || '')
      }
      openAiForm.value = {
        baseUrl: String(openai.baseUrl || ''),
        apiKey: String(openai.apiKey || ''),
        model: String(openai.model || '')
      }
    }
  } catch (err) {
    console.error('加载翻译提供商失败:', err)
    error('加载翻译提供商失败')
  } finally {
    loading.value = false
  }
}

function isEnabled(p: ProviderEntry): boolean {
  return enabledIds.value.has(p.id)
}

function isDefault(p: ProviderEntry): boolean {
  return defaultId.value === p.id
}

async function handleToggle(p: ProviderEntry, enabled: boolean): Promise<void> {
  try {
    const res = await window.ztools.internal.providers.setEnabled(p.id, enabled)
    if (res.success && res.data) {
      settings.value = res.data
      success(enabled ? '已启用' : '已禁用')
    } else {
      error(res.error || '操作失败')
    }
  } catch (err) {
    console.error('切换翻译提供商失败:', err)
    error('操作失败')
  }
}

async function handleSetDefault(p: ProviderEntry): Promise<void> {
  try {
    const res = await window.ztools.internal.providers.setDefault('translation', p.id)
    if (res.success && res.data) {
      settings.value = res.data
      success(`已设为默认：${p.label}`)
    } else {
      error(res.error || '操作失败')
    }
  } catch (err) {
    console.error('设置默认翻译提供商失败:', err)
    error('操作失败')
  }
}

// 内置 Bergamot 引擎开关与状态轮询
const bergamot = computed(() => providers.value.find((p) => p.id === 'builtin-bergamot'))

async function refreshEngineStatus(): Promise<void> {
  try {
    const res = await window.ztools.internal.providers.getTranslationStatus()
    engineStatus.value = res.status
    engineError.value = res.error || ''
  } catch {
    /* ignore */
  }
}

async function handleBergamotToggle(enabled: boolean): Promise<void> {
  try {
    await window.ztools.internal.providers.setTranslationEnabled(enabled)
    // 开启后立即拉取状态并轮询，直到 ready / error
    await refreshEngineStatus()
    if (
      enabled &&
      (engineStatus.value === 'downloading' || engineStatus.value === 'initializing')
    ) {
      startStatusPolling()
    }
  } catch (err) {
    console.error('切换翻译引擎失败:', err)
    error('切换翻译引擎失败')
  }
}

function startStatusPolling(): void {
  if (statusTimer) return
  statusTimer = setInterval(async () => {
    await refreshEngineStatus()
    if (
      engineStatus.value === 'ready' ||
      engineStatus.value === 'error' ||
      engineStatus.value === 'idle'
    ) {
      stopStatusPolling()
    }
  }, 1500)
}

function stopStatusPolling(): void {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
}

const engineStatusText = computed(() => {
  switch (engineStatus.value) {
    case 'downloading':
      return '正在下载翻译模型...'
    case 'initializing':
      return '正在初始化翻译引擎...'
    case 'ready':
      return '翻译引擎就绪'
    case 'error':
      return '翻译引擎初始化失败'
    default:
      return ''
  }
})

onMounted(async () => {
  await load()
  await refreshEngineStatus()
})

import { onUnmounted } from 'vue'
onUnmounted(stopStatusPolling)
</script>

<template>
  <div class="content-panel">
    <div class="scrollable-content">
      <div class="section-title">搜索翻译</div>
      <p class="card-desc online-intro">
        搜索栏的快速翻译使用下方所选服务，默认选择有道。保存配置不会发送请求；在线服务需要你自己的密钥。
      </p>
      <section class="card online-card" data-testid="youdao-translation-settings">
        <div class="builtin-header">
          <h3 class="card-title">有道翻译</h3>
          <span v-if="quickProviderId === 'builtin-youdao'" class="source-badge builtin-badge"
            >用于搜索翻译</span
          >
        </div>
        <p class="card-desc">
          有道智云文本翻译 API。标准接口目前只返回译文；音标与释义仅在服务返回时显示。
        </p>
        <label
          >AppKey<input
            v-model="youdaoForm.appKey"
            autocomplete="off"
            spellcheck="false"
            placeholder="应用 ID"
        /></label>
        <label
          >AppSecret<input
            v-model="youdaoForm.appSecret"
            type="password"
            autocomplete="new-password"
            placeholder="应用密钥"
        /></label>
        <div class="online-actions">
          <button class="text-btn" :disabled="saving" @click="saveOnlineProvider('builtin-youdao')">
            保存配置
          </button>
          <button
            class="text-btn"
            :disabled="saving"
            @click="saveOnlineProvider('builtin-youdao', true)"
          >
            {{ quickProviderId === 'builtin-youdao' ? '保存并继续使用' : '保存并用于搜索翻译' }}
          </button>
        </div>
      </section>
      <section class="card online-card" data-testid="openai-translation-settings">
        <div class="builtin-header">
          <h3 class="card-title">OpenAI 兼容翻译</h3>
          <span
            v-if="quickProviderId === 'builtin-openai-translation'"
            class="source-badge builtin-badge"
            >用于搜索翻译</span
          >
        </div>
        <label
          >API 地址<input
            v-model="openAiForm.baseUrl"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://你的服务地址/v1"
        /></label>
        <p class="card-desc">
          填写 HTTPS 基础地址（一般以 /v1 结尾），也支持完整 /chat/completions 地址；本机服务可使用
          HTTP。
        </p>
        <label
          >API Key<input
            v-model="openAiForm.apiKey"
            type="password"
            autocomplete="new-password"
            placeholder="服务密钥"
        /></label>
        <label
          >模型<input
            v-model="openAiForm.model"
            autocomplete="off"
            spellcheck="false"
            placeholder="服务提供的模型名称"
        /></label>
        <div class="online-actions">
          <button
            class="text-btn"
            :disabled="saving"
            @click="saveOnlineProvider('builtin-openai-translation')"
          >
            保存配置
          </button>
          <button
            class="text-btn"
            :disabled="saving"
            @click="saveOnlineProvider('builtin-openai-translation', true)"
          >
            {{
              quickProviderId === 'builtin-openai-translation'
                ? '保存并继续使用'
                : '保存并用于搜索翻译'
            }}
          </button>
        </div>
      </section>

      <!-- 内置 Bergamot 引擎说明 -->
      <div class="card builtin-card">
        <div class="builtin-info">
          <div class="builtin-header">
            <h3 class="card-title">离线翻译引擎（内置）</h3>
            <span v-if="bergamot" class="source-badge builtin-badge">内置</span>
          </div>
          <p class="card-desc">
            选中文字触发超级面板时，自动翻译为中文显示（使用 Bergamot 离线翻译引擎，首次启用需下载约
            55MB 模型）
          </p>
          <span v-if="engineStatusText" class="engine-status" :class="`status-${engineStatus}`">
            {{ engineStatusText }}
          </span>
          <span v-if="engineStatus === 'error' && engineError" class="engine-status status-error">
            {{ engineError }}
          </span>
        </div>
        <div class="setting-control">
          <label class="toggle">
            <input
              type="checkbox"
              :checked="engineStatus !== 'idle'"
              :disabled="engineStatus === 'downloading' || engineStatus === 'initializing'"
              @change="handleBergamotToggle(($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- 插件翻译提供商列表 -->
      <div v-if="providers.filter((p) => p.source === 'plugin').length > 0" class="section-title">
        插件翻译提供商
      </div>
      <div class="provider-list">
        <div
          v-for="p in providers.filter((p) => p.source === 'plugin')"
          :key="p.id"
          class="card provider-item"
        >
          <div class="provider-info">
            <div class="provider-header">
              <img
                v-if="p.pluginLogo"
                :src="p.pluginLogo"
                class="provider-logo"
                alt=""
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <h3 class="card-title">{{ p.label }}</h3>
              <span class="source-badge plugin-badge">插件</span>
              <span v-if="p.pluginName" class="plugin-name">来自：{{ p.pluginName }}</span>
            </div>
            <p v-if="p.description" class="card-desc">{{ p.description }}</p>
          </div>
          <div class="provider-actions">
            <button
              class="text-btn"
              :class="{ 'text-btn-active': isDefault(p) }"
              :disabled="!isEnabled(p)"
              @click="handleSetDefault(p)"
            >
              {{ isDefault(p) ? '默认' : '设为默认' }}
            </button>
            <label class="toggle toggle-sm">
              <input
                type="checkbox"
                :checked="isEnabled(p)"
                @change="handleToggle(p, ($event.target as HTMLInputElement).checked)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 空状态（仅当既无内置也无插件且引擎未启用时） -->
      <div v-if="!loading && providers.length === 0 && engineStatus === 'idle'" class="empty-state">
        <div class="i-z-translate empty-icon font-size-64px" />
        <div class="empty-text">暂无翻译提供商</div>
        <div class="empty-hint">启用上方离线引擎，或安装支持翻译的插件即可接入</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.online-intro {
  margin-bottom: 16px;
}
.online-card {
  padding: 16px;
  margin-bottom: 16px;
}
.online-card label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-primary);
}
.online-card input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-color);
  color: var(--text-primary);
}
.online-actions {
  display: flex;
  gap: 16px;
  margin-top: 14px;
}

.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}
.builtin-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  margin-bottom: 16px;
}
.builtin-info {
  flex: 1;
  min-width: 0;
}
.builtin-header,
.provider-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0;
}
.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}
.engine-status {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--primary-color);
}
.engine-status.status-ready {
  color: var(--success-color);
}
.engine-status.status-error {
  color: var(--danger-color);
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 8px 0 12px 4px;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.provider-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
}
.provider-item:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.provider-info {
  flex: 1;
  min-width: 0;
}
.provider-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: contain;
  flex-shrink: 0;
}
.plugin-name {
  font-size: 11px;
  color: var(--text-secondary);
}
.source-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
}
.builtin-badge {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}
.plugin-badge {
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
}
.provider-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 16px;
  flex-shrink: 0;
}
.text-btn {
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid var(--divider-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.text-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.text-btn-active {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-light-bg);
}
.toggle-sm {
  display: flex;
  align-items: center;
  width: 36px;
  height: 20px;
  margin: 0;
}
.toggle-sm .toggle-slider {
  border-radius: 20px;
}
.toggle-sm .toggle-slider::before {
  width: 12px;
  height: 12px;
}
.toggle-sm input:checked + .toggle-slider::before {
  transform: translateX(16px);
}
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  pointer-events: none;
}
.empty-icon {
  color: var(--text-secondary);
  opacity: 0.3;
  margin-bottom: 16px;
}
.empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}
.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
