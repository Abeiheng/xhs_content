<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CommentResult } from '../../../shared/types'
const props = defineProps<{
  row: CommentResult
  account: string
  sending: boolean
  error: string
}>()
const emit = defineEmits<{ close: []; send: [content: string]; open: [url: string] }>()
const content = ref(props.row.reply?.status === 'unknown' ? props.row.reply.content : '')
const valid = computed(() => !!content.value.trim() && content.value.trim().length <= 500)
</script>
<template>
  <el-dialog
    :model-value="true"
    title="回复评论"
    width="298px"
    top="10vh"
    :teleported="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!sending"
    :show-close="!sending"
    class="reply-dialog"
    @close="!sending && emit('close')"
  >
    <p class="reply-account">使用账号：{{ account || '当前已登录账号' }}</p>
    <blockquote class="reply-original">
      <strong>{{ row.nickname || '未提供昵称' }}</strong>
      <p>{{ row.content }}</p>
    </blockquote>
    <label for="reply-content" class="reply-label">回复内容</label>
    <el-input
      id="reply-content"
      v-model="content"
      type="textarea"
      :rows="4"
      resize="none"
      maxlength="500"
      show-word-limit
      placeholder="输入要发送给对方的回复"
      :disabled="sending"
      autofocus
    />
    <p v-if="sending" class="help" role="status">正在定位原评论并发送，请稍候…</p>
    <p v-if="error || row.reply?.status === 'unknown'" class="reply-error" role="alert">
      {{ error || row.reply?.message }}
    </p>
    <button
      v-if="row.workUrl"
      class="text-button reply-work-link"
      :disabled="sending"
      @click="emit('open', row.workUrl)"
    >
      打开原作品 ↗
    </button>
    <template #footer>
      <el-button size="small" :disabled="sending" @click="emit('close')">取消</el-button>
      <el-button
        type="primary"
        size="small"
        :loading="sending"
        :disabled="!valid || sending"
        @click="emit('send', content)"
        >发送回复</el-button
      >
    </template>
  </el-dialog>
</template>
