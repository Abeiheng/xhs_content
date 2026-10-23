<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Check, Delete } from '@element-plus/icons-vue'
import { maxWorksPerKeyword, parseKeywords, workTimeRanges } from '../../../shared/rules'
import type { CommentKeywordGroup, FilterSettings, Settings, Theme } from '../../../shared/types'
const props = defineProps<{ settings: Settings; locked: boolean; saving: boolean }>()
const emit = defineEmits<{
  back: []
  save: [value: FilterSettings]
  theme: [theme: Theme]
  browseMcpPath: []
}>()
function cloneGroups(settings: Settings): CommentKeywordGroup[] {
  const source = settings.commentGroups?.length
    ? settings.commentGroups
    : [{ name: '默认组合', include: settings.commentKeywords, exclude: [] }]
  return source.map((group) => ({
    name: group.name,
    include: [...group.include],
    exclude: [...group.exclude]
  }))
}
const groups = ref<CommentKeywordGroup[]>(cloneGroups(props.settings))
const activeGroup = ref(props.settings.activeCommentGroup || 0)
const interval = ref<number | undefined>(props.settings.intervalSeconds)
const timeRange = ref(props.settings.workTimeRange)
const worksPerKeyword = ref<number | undefined>(props.settings.worksPerKeyword)
const replyIntervalSeconds = ref<number | undefined>(props.settings.replyIntervalSeconds)
const mcpPath = ref(props.settings.mcpPath || '')
const errors = ref<Record<string, string>>({})
const commentInput = ref<{ focus: () => void }>()
const currentGroup = computed(() => groups.value[activeGroup.value])
const groupName = computed({
  get: () => currentGroup.value?.name || '',
  set: (value: string) => {
    if (currentGroup.value) currentGroup.value.name = value
  }
})
const includeText = computed({ get: () => currentGroup.value?.include.join(',') || '', set: (v) => { if (currentGroup.value) currentGroup.value.include = parseKeywords(v) } })
const excludeText = computed({ get: () => currentGroup.value?.exclude.join(',') || '', set: (v) => { if (currentGroup.value) currentGroup.value.exclude = parseKeywords(v) } })
const themes: { id: Theme; name: string; color: string }[] = [
  { id: 'red', name: '经典红', color: '#FF0200' },
  { id: 'blue', name: '清水蓝', color: '#2463EB' },
  { id: 'green', name: '竹叶绿', color: '#237A57' },
  { id: 'purple', name: '柔雾紫', color: '#7952B3' }
]
const dirty = computed(
  () =>
    JSON.stringify(groups.value) !== JSON.stringify(props.settings.commentGroups || [{ name: '默认组合', include: props.settings.commentKeywords, exclude: [] }]) ||
    interval.value !== props.settings.intervalSeconds ||
    timeRange.value !== props.settings.workTimeRange ||
    worksPerKeyword.value !== props.settings.worksPerKeyword ||
    replyIntervalSeconds.value !== props.settings.replyIntervalSeconds
    || mcpPath.value !== (props.settings.mcpPath || '')
)
function focusMissing(): void {
  if (!currentGroup.value?.include.length) commentInput.value?.focus()
}
function addGroup(): void {
  groups.value.push({ name: `组合 ${groups.value.length + 1}`, include: [], exclude: [] })
  activeGroup.value = groups.value.length - 1
}
function removeGroup(): void {
  if (groups.value.length <= 1) return
  groups.value.splice(activeGroup.value, 1)
  activeGroup.value = Math.min(activeGroup.value, groups.value.length - 1)
}
function plainGroups(): CommentKeywordGroup[] {
  return groups.value.map((group) => ({
    name: String(group.name),
    include: [...group.include],
    exclude: [...group.exclude]
  }))
}
function save(): void {
  errors.value = {}
  if (!currentGroup.value?.include.length) errors.value.comment = '请填写至少一个评论关键词'
  if (
    !Number.isInteger(interval.value) ||
    !interval.value ||
    interval.value < 1 ||
    interval.value > 1440
  )
    errors.value.interval = '请输入 1–1440 的整数'
  if (
    !Number.isInteger(worksPerKeyword.value) ||
    !worksPerKeyword.value ||
    worksPerKeyword.value < 1 ||
    worksPerKeyword.value > maxWorksPerKeyword
  )
    errors.value.quantity = `请输入 1–${maxWorksPerKeyword} 的整数`
  if (
    !Number.isInteger(replyIntervalSeconds.value) ||
    replyIntervalSeconds.value! < 0 ||
    replyIntervalSeconds.value! > 3600
  )
    errors.value.replyInterval = '请输入 0–3600 秒的整数'
  if (Object.keys(errors.value).length) {
    focusMissing()
    return
  }
  emit('save', {
    workTimeRange: timeRange.value,
    // Convert the reactive array to a plain array before crossing Electron's
    // IPC boundary; structuredClone cannot clone Vue proxies.
    commentKeywords: [...currentGroup.value!.include],
    commentGroups: plainGroups(),
    activeCommentGroup: activeGroup.value,
    intervalSeconds: interval.value!,
    worksPerKeyword: worksPerKeyword.value!,
    replyIntervalSeconds: replyIntervalSeconds.value!,
    mcpPath: mcpPath.value.trim()
  })
}
function markSaved(settings: Settings): void {
  groups.value = cloneGroups(settings)
  activeGroup.value = settings.activeCommentGroup || 0
  interval.value = settings.intervalSeconds
  timeRange.value = settings.workTimeRange
  worksPerKeyword.value = settings.worksPerKeyword
  replyIntervalSeconds.value = settings.replyIntervalSeconds
  mcpPath.value = settings.mcpPath || ''
}
function setMcpPath(path: string): void {
  mcpPath.value = path
}
defineExpose({ focusMissing, markSaved, setMcpPath })
</script>
<template>
  <section class="settings-view view">
    <div class="view-heading">
      <button class="icon-button back" aria-label="返回采集结果" @click="$emit('back')">
        <ArrowLeft />
      </button>
      <h1>设置</h1>
      <span v-if="dirty" class="draft-label">未保存</span>
    </div>
    <div class="settings-scroll">
      <p v-if="locked" class="locked-note">任务结束后可修改筛选规则</p>
      <div class="form-field">
        <label for="works-per-keyword">每次采集候选作品数量</label>
        <div class="interval-field">
          <el-input-number
            id="works-per-keyword"
            v-model="worksPerKeyword"
            :controls="false"
            :disabled="locked"
            :min="1"
            :max="maxWorksPerKeyword"
            aria-label="每次采集候选作品数量"
          /><span>个</span>
        </div>
        <p v-if="errors.quantity" class="field-error" role="alert">{{ errors.quantity }}</p>
        <p class="help">默认 10 个候选作品，可设 1–{{ maxWorksPerKeyword }} 个；按候选顺序采集。</p>
      </div>
      <div class="form-field">
        <label for="mcp-path">MCP 组件路径</label>
        <div class="mcp-path-field">
          <el-input
            id="mcp-path"
            v-model="mcpPath"
            placeholder="使用应用内置组件"
            :disabled="locked"
            clearable
          />
          <el-button :disabled="locked" @click="$emit('browseMcpPath')">选择</el-button>
        </div>
        <p class="help">可选择 xiaohongshu-mcp.exe 或其所在目录；留空使用安装包内置版本。</p>
      </div>
      <div class="form-field">
        <div class="comment-filter-card">
          <div class="comment-filter-heading">
            <div>
              <span class="field-eyebrow">评论筛选</span>
              <strong>筛选组合</strong>
            </div>
            <span class="group-count">{{ groups.length }} 组</span>
          </div>
          <div class="group-row">
            <el-select id="comment-group" v-model="activeGroup" aria-label="评论筛选组合">
              <el-option v-for="(group, index) in groups" :key="index" :label="group.name" :value="index" />
            </el-select>
            <el-button class="add-group-button" size="small" @click="addGroup">＋ 新增</el-button>
            <el-button
              class="delete-group-button"
              size="small"
              :disabled="locked || groups.length <= 1"
              aria-label="删除当前组合"
              title="删除当前组合"
              @click="removeGroup"
            ><Delete /></el-button>
          </div>
          <el-input
            id="comment-group-name"
            v-model="groupName"
            class="group-name-input"
            placeholder="给当前组合起个名字"
            aria-label="当前组合名称"
            maxlength="24"
            show-word-limit
          />
          <p class="help group-name-help">名称只用于识别，不影响匹配规则。</p>
        </div>
        <label for="comment-keywords">评论关键词</label>
        <el-input
          id="comment-keywords"
          ref="commentInput"
          v-model="includeText"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="例如：报价,多少钱,求推荐"
          :disabled="locked"
          :class="{ invalid: errors.comment }"
        />
        <p v-if="errors.comment" class="field-error" role="alert">{{ errors.comment }}</p>
        <p class="help">当前组合命中任意一个关键词即可</p>
        <label for="comment-block-words">评论屏蔽词</label>
        <el-input id="comment-block-words" v-model="excludeText" placeholder="例如：广告,引流" :disabled="locked" />
        <p class="help">命中任意屏蔽词的评论不会显示；屏蔽词优先。</p>
      </div>
      <div class="form-field">
        <label for="work-interval">作品间隔（秒）</label>
        <div class="interval-field">
          <el-input-number
            id="work-interval"
            v-model="interval"
            :controls="false"
            :disabled="locked"
            :min="1"
            :max="86400"
            aria-label="作品间隔（秒）"
          /><span>秒</span>
        </div>
        <p v-if="errors.interval" class="field-error" role="alert">{{ errors.interval }}</p>
        <p class="help">当前作品完成后开始等待；默认 60 秒，最多 86400 秒</p>
      </div>
      <div class="form-field">
        <label for="work-time-range">作品发布时间范围</label>
        <el-select
          id="work-time-range"
          v-model="timeRange"
          :disabled="locked"
          aria-label="作品发布时间范围"
        >
          <el-option v-for="range in workTimeRanges" :key="range" :label="range" :value="range" />
        </el-select>
        <p class="help">修改后需重新搜索候选作品；按作品发布时间筛选。</p>
      </div>
      <div class="form-field">
        <label for="reply-interval">回复间隔</label>
        <div class="interval-field">
          <el-input-number
            id="reply-interval"
            v-model="replyIntervalSeconds"
            :controls="false"
            :disabled="locked"
            :min="0"
            :max="3600"
            aria-label="回复间隔（秒）"
          /><span>秒</span>
        </div>
        <p v-if="errors.replyInterval" class="field-error" role="alert">{{ errors.replyInterval }}</p>
        <p class="help">每次成功回复后至少等待该时间；设为 0 表示不等待。</p>
      </div>
      <div class="form-field themes-field">
        <label>主题颜色</label>
        <div class="theme-grid" role="group" aria-label="主题颜色">
          <button
            v-for="theme in themes"
            :key="theme.id"
            class="theme-choice"
            :class="{ selected: settings.theme === theme.id }"
            :aria-pressed="settings.theme === theme.id"
            @click="$emit('theme', theme.id)"
          >
            <span class="swatch-box"
              ><span class="swatch" :style="{ background: theme.color }"
                ><Check v-if="settings.theme === theme.id" /></span></span
            ><span>{{ theme.name }}</span>
          </button>
        </div>
      </div>
    </div>
    <footer class="settings-footer">
      <el-button
        class="outline-button save-button"
        :loading="saving"
        :disabled="locked"
        @click="save"
        >保存设置</el-button
      >
      <p class="help">主题即时生效，筛选规则保存后生效</p>
    </footer>
  </section>
</template>
