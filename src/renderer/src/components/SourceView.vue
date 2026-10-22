<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, Search, CircleCheck } from '@element-plus/icons-vue'
import type { AppState, LoginQr } from '../../../shared/types'
defineProps<{ state: AppState; locked: boolean }>()
const emit = defineEmits<{ back: []; update: [state: AppState]; error: [error: unknown] }>()
const api = window.api
const pending = ref(false)
const query = ref('')
const qr = ref<LoginQr>()
const feedback = ref('')
const failure = ref('')
async function run(action: () => Promise<void>): Promise<void> {
  if (pending.value) return
  pending.value = true
  feedback.value = ''
  failure.value = ''
  try {
    await action()
  } catch (error) {
    failure.value = String(error instanceof Error ? error.message : error).replace(
      /^Error invoking remote method '[^']+': Error: /,
      ''
    )
    emit('error', error)
  } finally {
    pending.value = false
  }
}
async function connect(): Promise<void> {
  await run(async () => emit('update', await api.connect()))
}
async function visibility(value: boolean | string | number): Promise<void> {
  await run(async () => {
    emit('update', await api.browserVisible(Boolean(value)))
    feedback.value = value ? '已显示采集浏览器，可检查页面验证' : '已切换到后台运行，登录状态已保留'
  })
}
async function getQr(): Promise<void> {
  await run(async () => {
    qr.value = await api.loginQr()
    if (qr.value.loggedIn) feedback.value = '当前账号已登录'
  })
}
async function check(): Promise<void> {
  await run(async () => {
    const state = await api.loginStatus()
    emit('update', state)
    if (state.integration.loggedIn) {
      qr.value = undefined
      feedback.value = '登录成功，可以搜索作品了'
    } else feedback.value = '尚未登录，请扫码并在手机端确认'
  })
}
async function search(): Promise<void> {
  await run(async () => {
    const state = await api.search(query.value)
    emit('update', state)
    feedback.value = '搜索完成'
  })
}
async function removeCandidate(workId: string): Promise<void> {
  await run(async () => emit('update', await api.removeCandidate(workId)))
}
async function openCandidate(url: string | null): Promise<void> {
  if (url) await api.openExternal(url)
}
</script>
<template>
  <section class="source-view view">
    <div class="view-heading">
      <button class="icon-button back" aria-label="返回采集结果" @click="$emit('back')">
        <ArrowLeft />
      </button>
      <h1>小红书接入</h1>
      <span class="integration-tag">MCP</span>
    </div>
    <div class="source-scroll">
      <div class="connection-card">
        <div class="connection-head">
          <i class="connection-dot" :class="{ ready: state.integration.status === 'ready' }"></i
          ><strong>{{
            state.integration.status === 'ready' ? '采集服务已连接' : '本地采集服务'
          }}</strong>
        </div>
        <p class="help">{{ state.integration.message }}</p>
        <el-button
          v-if="state.integration.status !== 'ready'"
          class="outline-button"
          :loading="pending"
          :disabled="locked"
          @click="connect"
          >{{
            state.integration.status === 'starting' || state.integration.status === 'installing'
              ? '正在准备'
              : '安装 / 启动服务'
          }}</el-button
        >
        <p v-if="state.integration.status !== 'ready'" class="help setup-help">
          首次使用会下载采集组件和浏览器，后续可直接启动。
        </p>
      </div>
      <div class="browser-mode-control">
        <div>
          <strong>显示采集浏览器</strong>
          <p class="help">默认后台运行；需要查看页面或手动验证时开启。</p>
        </div>
        <el-switch
          :model-value="state.integration.visibleBrowser"
          :disabled="pending || locked || !state.integration.managed"
          aria-label="显示采集浏览器"
          @change="visibility"
        />
      </div>
      <template v-if="state.integration.status === 'ready'">
        <div class="source-section">
          <div class="section-label">
            <strong>账号登录</strong
            ><span :class="{ 'login-success': state.integration.loggedIn }">{{
              state.integration.loggedIn ? state.integration.username || '已登录' : '尚未确认登录'
            }}</span>
          </div>
          <div v-if="state.integration.loggedIn" class="login-banner">
            <CircleCheck />登录状态已确认
          </div>
          <div v-else class="qr-section">
            <img v-if="qr?.image" :src="qr.image" alt="小红书登录二维码" class="login-qr" />
            <p v-if="qr?.image" class="help">使用小红书 App 扫码并确认 · 二维码约 4 分钟有效</p>
            <p v-else class="help">获取二维码后，使用小红书 App 扫码登录。</p>
          </div>
          <div class="login-actions">
            <el-button :disabled="pending || locked" size="small" @click="getQr">{{
              qr?.image ? '刷新二维码' : '获取二维码'
            }}</el-button
            ><el-button :disabled="pending || locked" size="small" @click="check"
              >检查登录状态</el-button
            >
          </div>
        </div>
        <div class="source-section">
          <label class="section-label" for="search-query"><strong>搜索候选作品</strong></label>
          <p class="help">作品发布时间：{{ state.settings.workTimeRange }}</p>
          <div class="search-field">
            <el-input
              id="search-query"
              v-model="query"
              placeholder="输入搜索内容"
              :disabled="pending || locked || !state.integration.loggedIn"
              maxlength="100"
              @keyup.enter="search"
            /><el-button
              class="outline-button"
              aria-label="搜索作品"
              :disabled="pending || locked || !state.integration.loggedIn || !query.trim()"
              @click="search"
              ><Search
            /></el-button>
          </div>
          <p class="help">
            搜索结果会加入候选列表，采集时按列表顺序处理；搜索词不会写入筛选规则。
          </p>
        </div>
        <div class="candidate-summary">
          <div>
            <strong>{{ state.sourceCount }}</strong
          ><span> 个候选作品 · 预计 {{ Math.max(1, Math.ceil(state.sourceCount * 0.5)) }} 分钟</span>
          </div>
          <button
            class="text-button"
            :disabled="pending || locked"
            @click="run(async () => $emit('update', await api.clearCandidates()))"
          >
            清空列表
          </button>
        </div>
      </template>
      <p v-if="pending && state.integration.operation" class="operation-note" role="status">
        {{ state.integration.operation }}，请稍候…
      </p>
      <p v-if="feedback" class="source-feedback" role="status">{{ feedback }}</p>
      <div v-if="failure" class="source-failure" role="alert">
        <p>{{ failure }}</p>
        <el-button
          v-if="query.trim() && state.integration.loggedIn && state.integration.status === 'ready'"
          size="small"
          :disabled="pending || locked"
          @click="search"
          >重新搜索</el-button
        >
      </div>
      <div v-if="state.candidates?.length" class="candidate-preview">
        <div class="section-label"><strong>采集预览</strong><span>可移除不需要的作品</span></div>
        <div class="candidate-list">
          <div v-for="candidate in (state.candidates || []).slice(0, 30)" :key="candidate.id" class="candidate-item">
            <div class="candidate-copy">
              <button
                class="candidate-link"
                :disabled="!candidate.url"
                :title="candidate.url ? '打开小红书作品详情' : '暂无作品链接'"
                @click="openCandidate(candidate.url)"
              >{{ candidate.title || '未提供标题' }}</button>
              <small>{{ candidate.publishedAt ? new Date(candidate.publishedAt).toLocaleDateString('zh-CN') : '时间未提供' }}</small>
            </div>
            <button class="candidate-remove" :disabled="pending || locked" :aria-label="`移除 ${candidate.title || '该作品'}`" @click="removeCandidate(candidate.id)">移除</button>
          </div>
        </div>
        <p v-if="(state.candidates || []).length > 30" class="help">仅展示前 30 个，剩余作品会按候选顺序采集。</p>
      </div>
      <p v-if="locked" class="locked-note">任务结束后可登录、搜索或更换候选作品。</p>
      <div class="source-explanation">
        <strong>本次采集范围</strong>
        <p>每个作品最多读取 200 条一级评论，包含实际返回的回复；不自动展开全部楼中楼。平台返回不完整时会暂停并提示重试。</p>
        <p>登录凭证、候选作品和评论结果保存在本机，不会由本应用上传到第三方服务。登录或验证需要你在手机及采集浏览器中完成。</p>
        <button
          class="text-button"
          @click="api.openExternal('https://github.com/xpzouying/xiaohongshu-mcp')"
        >
          由 xiaohongshu-mcp 提供采集能力 ↗
        </button>
      </div>
    </div>
    <footer class="settings-footer source-footer">
      <el-button class="outline-button save-button" @click="$emit('back')">返回采集结果</el-button>
      <p class="help">搜索完成后，回到结果页开始采集</p>
    </footer>
  </section>
</template>
