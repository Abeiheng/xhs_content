<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import AppTitleBar from './components/AppTitleBar.vue'
import SettingsView from './components/SettingsView.vue'
import TaskStatus from './components/TaskStatus.vue'
import ResultsTable from './components/ResultsTable.vue'
import SourceView from './components/SourceView.vue'
import ReplyDialog from './components/ReplyDialog.vue'
import SupportDialog from './components/SupportDialog.vue'
import type { AppState, CommentResult, FilterSettings, Theme } from '../../shared/types'
const api = window.api
const state = ref<AppState>()
const view = ref<'results' | 'settings' | 'source'>('results')
const pinned = ref(false)
const saving = ref(false)
const busy = ref(false)
const rows = ref<CommentResult[]>([])
const page = ref(1)
const settingsView = ref<InstanceType<typeof SettingsView>>()
const replyRow = ref<CommentResult>()
const replySending = ref(false)
const replyError = ref('')
const resetVisible = ref(false)
const support = ref<'donation' | 'feedback'>()
const resetDisabled = computed(
  () => locked.value || busy.value || saving.value || !!state.value?.integration.operation
)
const replyDisabledReason = computed(() =>
  locked.value
    ? '请先结束采集任务再回复'
    : busy.value || state.value?.integration.operation
      ? '请等待当前操作完成'
      : state.value?.integration.status !== 'ready' || !state.value.integration.loggedIn
        ? '请先在小红书接入页启动服务并确认登录状态'
        : ''
)
const locked = computed(
  () =>
    !!state.value && ['reading', 'waiting', 'paused', 'attention'].includes(state.value.task.phase)
)
const configured = computed(
  () => !!state.value?.settings.commentKeywords.length
)
const paused = computed(() => ['paused', 'attention'].includes(state.value?.task.phase || ''))
const palettes = {
  red: ['#FF0200', '#FFF0EF'],
  blue: ['#2463EB', '#EDF3FF'],
  green: ['#237A57', '#EAF5EF'],
  purple: ['#7952B3', '#F2EDF8']
}
const themeStyle = computed(() => {
  const [primary, light] = palettes[state.value?.settings.theme || 'red']
  return {
    '--accent': primary,
    '--accent-light': light,
    '--el-color-primary': primary,
    '--el-color-primary-light-9': light,
    '--el-color-primary-light-7': light,
    '--el-color-primary-light-3': primary
  }
})
let unsubscribe: (() => void) | undefined
let resultRequest = 0
function errorMessage(error: unknown): void {
  ElMessage({
    type: 'error',
    message: String(error instanceof Error ? error.message : error).replace(
      /^Error invoking remote method '[^']+': Error: /,
      ''
    ),
    duration: 4500
  })
}
async function run(fn: () => Promise<unknown>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } catch (error) {
    errorMessage(error)
  } finally {
    busy.value = false
  }
}
async function loadResults(): Promise<void> {
  const request = ++resultRequest
  const data = await api.results(page.value)
  if (request === resultRequest) rows.value = data.rows
}
async function update(next: AppState): Promise<void> {
  const previous = state.value
  const changedSource = previous?.source !== next.source
  state.value = next
  if (changedSource) {
    page.value = 1
  }
  if (changedSource || previous?.resultCount !== next.resultCount) {
    if (!changedSource && previous && next.resultCount > previous.resultCount)
    await loadResults()
  }
}
async function openSettings(focus = false): Promise<void> {
  view.value = 'settings'
  if (focus) {
    await nextTick()
    settingsView.value?.focusMissing()
  }
}
async function save(value: FilterSettings): Promise<void> {
  saving.value = true
  try {
    const rangeChanged = value.workTimeRange !== state.value?.settings.workTimeRange
    await update(await api.saveSettings(value))
    settingsView.value?.markSaved(state.value!.settings)
    ElMessage.success(
      rangeChanged ? '设置已保存，作品时间范围已更新，请重新搜索候选作品' : '设置已保存'
    )
    view.value = 'results'
  } catch (error) {
    errorMessage(error)
  } finally {
    saving.value = false
  }
}
async function theme(value: Theme): Promise<void> {
  try {
    await update(await api.theme(value))
  } catch (error) {
    errorMessage(error)
  }
}
async function browseMcpPath(): Promise<void> {
  try {
    const selected = await api.selectMcpPath()
    if (!selected) return
    settingsView.value?.setMcpPath(selected)
  } catch (error) {
    errorMessage(error)
  }
}
async function action(): Promise<void> {
  if (!configured.value) {
    await openSettings(true)
    return
  }
  await run(async () => {
    await update(await (paused.value ? api.resume() : locked.value ? api.pause() : api.start()))
  })
}
async function changePage(value: number): Promise<void> {
  page.value = value
  await run(loadResults)
}
async function latest(): Promise<void> {
  page.value = Math.max(1, Math.ceil((state.value?.resultCount || 0) / 50))
  await run(loadResults)
}
async function exportResults(): Promise<void> {
  await run(async () => {
    await api.exportResults()
    ElMessage.success('评论已导出')
  })
}
async function resetCollection(): Promise<void> {
  if (resetDisabled.value) return
  await run(async () => {
    const next = await api.resetCollection()
    page.value = 1
    replyRow.value = undefined
    await update(next)
    await loadResults()
    resetVisible.value = false
    ElMessage.success('采集已重置，请重新搜索或导入作品')
  })
}
function openReply(row: CommentResult): void {
  if (replyDisabledReason.value || row.source !== 'mcp') return
  replyRow.value = row
  replyError.value = ''
}
async function sendReply(content: string): Promise<void> {
  if (busy.value || replySending.value || !replyRow.value) return
  busy.value = true
  replySending.value = true
  replyError.value = ''
  const row = replyRow.value
  try {
    const record = await api.reply(row.workId, row.commentId, content)
    row.reply = record
    if (record.status === 'sent') {
      replyRow.value = undefined
      ElMessage.success(record.message)
    } else replyError.value = record.message
  } catch (error) {
    replyError.value = String(error instanceof Error ? error.message : error).replace(
      /^Error invoking remote method '[^']+': Error: /,
      ''
    )
  } finally {
    replySending.value = false
    busy.value = false
    await loadResults().catch(errorMessage)
  }
}
onMounted(async () => {
  if (!api) {
    errorMessage('请使用 Electron 桌面程序打开此界面')
    return
  }
  try {
    unsubscribe = api.subscribe((value) => {
      void update(value).catch(errorMessage)
    })
    await update(await api.state())
    if (state.value?.notice) ElMessage.warning(state.value.notice)
  } catch (error) {
    errorMessage(error)
  }
})
onUnmounted(() => unsubscribe?.())
</script>
<template>
  <div class="app-shell" :style="themeStyle">
    <AppTitleBar
      :pinned="pinned"
      :settings="view === 'settings'"
      :reset-disabled="!state || resetDisabled"
      @reset="resetVisible = true"
      @support="support = $event"
      @pin="
        run(async () => {
          pinned = await api.pin()
        })
      "
      @settings="view === 'settings' ? (view = 'results') : openSettings()"
      @close="api.close()"
    />
    <template v-if="state">
      <main v-show="view === 'results'" class="results-view view">
        <div class="results-heading">
          <h1>采集结果</h1>
        </div>
        <div class="source-toolbar">
          <div class="source-fixed-label"><i class="source-dot"></i>小红书 MCP</div>
          <button class="source-action" @click="view = 'source'">
            <Link />{{ state.integration.loggedIn ? '搜索作品' : '登录 / 搜索' }}
          </button>
        </div>
        <TaskStatus :task="state.task" :settings="state.settings" />
        <div class="source-summary">
          已获取 {{ state.sourceCount }} 个候选作品 · 先登录并搜索
          <button class="text-button export-button" :disabled="!state.resultCount || busy" @click="exportResults">导出评论</button>
        </div>
        <ResultsTable
          :rows="rows"
          :total="state.resultCount"
          source="mcp"
          :configured="configured"
          :phase="state.task.phase"
          :page="page"
          :reply-disabled="!!replyDisabledReason"
          :reply-disabled-reason="replyDisabledReason"
          @reply="openReply"
          @setup="openSettings(true)"
          @page="changePage"
          @latest="latest"
        />
        <footer class="results-footer">
          <div class="footer-copy">
            <span>{{
              state.task.phase === 'waiting'
                ? '下一作品倒计时'
                : locked
                  ? '正在按设置采集评论'
                  : state.task.phase === 'completed'
                    ? '结果已保存在本机'
                    : '准备好后，开始采集'
            }}</span
            ><small>{{
              '仅采集公开可用评论'
            }}</small>
          </div>
          <div class="footer-actions">
            <button
              v-if="locked"
              class="stop-button"
              title="结束任务，保留已有结果"
              @click="run(async () => update(await api.stop()))"
            >
              结束</button
            ><el-button class="outline-button task-button" :loading="busy" @click="action"
              ><el-icon v-if="!busy"
                ><VideoPlay v-if="!locked || paused" /><VideoPause v-else /></el-icon
              >{{
                paused
                  ? state.task.phase === 'attention'
                    ? '重试'
                    : '继续'
                  : locked
                    ? '暂停'
                    : '开始采集'
              }}</el-button
            >
          </div>
        </footer>
      </main>
      <SettingsView
        v-show="view === 'settings'"
        ref="settingsView"
        :settings="state.settings"
        :locked="locked"
        :saving="saving"
        @back="view = 'results'"
        @save="save"
        @theme="theme"
        @browse-mcp-path="browseMcpPath"
      />
      <SourceView
        v-show="view === 'source'"
        :state="state"
        :locked="locked"
        @back="view = 'results'"
        @update="update"
        @error="errorMessage"
      />
      <ReplyDialog
        v-if="replyRow"
        :row="replyRow"
        :account="state.integration.username || ''"
        :sending="replySending"
        :error="replyError"
        @close="!replySending && (replyRow = undefined)"
        @send="sendReply"
        @open="(url) => api.openExternal(url).catch(errorMessage)"
      />
      <el-dialog
        v-model="resetVisible"
        title="重置采集"
        width="298px"
        top="20vh"
        :teleported="false"
        :close-on-click-modal="false"
        :close-on-press-escape="!busy"
        :show-close="!busy"
        class="reset-dialog"
      >
        <p>将清空小红书采集结果、候选作品，并重置任务进度。</p>
        <p>筛选设置、主题、登录状态和回复记录会保留。清空后无法撤销，需重新搜索。</p>
        <template #footer>
          <el-button size="small" :disabled="busy" @click="resetVisible = false">取消</el-button>
          <el-button
            size="small"
            type="danger"
            :loading="busy"
            :disabled="resetDisabled"
            @click="resetCollection"
            >确认重置</el-button
          >
        </template>
      </el-dialog>
    </template>
    <div v-else class="loading-state">正在打开采集工作台…</div>
    <SupportDialog :mode="support" @close="support = undefined" />
  </div>
</template>
