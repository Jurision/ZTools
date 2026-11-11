<template>
  <div
    class="file-result"
    :class="{ selected }"
    :data-path="item.path"
    :title="item.path"
    @click.stop="emit('open', $event.ctrlKey || $event.metaKey)"
    @contextmenu.prevent.stop="emit('menu')"
  >
    <svg class="file-result-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path :d="iconPath" />
    </svg>
    <div class="file-result-text">
      <div class="file-result-name">
        <template v-for="(segment, index) in segments" :key="index">
          <mark v-if="segment.hit">{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </div>
      <div class="file-result-path">{{ item.path }}</div>
    </div>
    <div class="file-result-meta">
      <span v-if="notice" class="file-result-notice" role="status">{{ notice }}</span>
      <template v-else>
        <span v-if="modifiedText">{{ modifiedText }}</span>
        <span v-if="sizeText">{{ sizeText }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fileCategory, highlightSegments, type FileSearchItem } from '@shared/fileSearch'
import { computed } from 'vue'

interface Props {
  item: FileSearchItem
  /** File query used to emphasize literal hits in the name. */
  query: string
  selected?: boolean
  /** Short note replacing the date and size, such as "已复制路径". */
  notice?: string
}

const props = withDefaults(defineProps<Props>(), { selected: false, notice: '' })

const emit = defineEmits<{
  /** Click opens the item; Ctrl+click reveals it in its folder. */
  (e: 'open', reveal: boolean): void
  (e: 'menu'): void
}>()

const ICONS: Record<string, string> = {
  folder: 'M3 6h6l2 2h10v11H3z',
  document: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 15h7M9 18h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
  video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
  audio:
    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  archive: 'M5 4h14v16H5zM12 4v3M12 9v2M12 13v2M10.5 17h3',
  program: 'M4 5h16v14H4zM4 9h16M8 13l2 2-2 2M12.5 17h3.5',
  other: 'M6 3h9l4 4v14H6zM15 3v4h4'
}

const iconPath = computed(() => ICONS[fileCategory(props.item.name, props.item.isFolder)])
const segments = computed(() => highlightSegments(props.item.name, props.query))

const modifiedText = computed(() => {
  if (!props.item.modified) return ''
  const date = new Date(props.item.modified)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
})

const sizeText = computed(() => {
  const size = props.item.size
  if (props.item.isFolder || size === undefined) return ''
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
})
</script>

<style scoped>
.file-result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 12px;
  margin: 0 4px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  color: var(--text-color);
}
.file-result:hover {
  background: var(--hover-bg);
}
.file-result.selected {
  background: var(--primary-light-bg);
}
.file-result-icon {
  flex: none;
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  opacity: 0.8;
}
.file-result-text {
  flex: 1;
  min-width: 0;
}
.file-result-name {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-result-name mark {
  color: var(--highlight-color, var(--primary-color));
  background: transparent;
  font-weight: 600;
}
.file-result-path {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  line-height: 1.35;
}
.file-result-meta {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.file-result-notice {
  color: var(--highlight-color, var(--primary-color));
}
</style>
