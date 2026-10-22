<script setup lang="ts">
import { ChatLineSquare, ArrowRight } from '@element-plus/icons-vue'
import type { CommentResult, SourceMode } from '../../../shared/types'
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})
function commentTime(value: string | null): { date: string; time: string } | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(new Date(value)).map((p) => [p.type, p.value])
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`
  }
}
defineProps<{
  rows: CommentResult[]
  total: number
  source: SourceMode
  configured: boolean
  phase: string
  page: number
  replyDisabled: boolean
  replyDisabledReason: string
}>()
defineEmits<{
  setup: []
  latest: []
  page: [page: number]
  reply: [row: CommentResult]
}>()
</script>
<template>
  <div class="results-area">
    <el-table
      :data="rows"
      height="100%"
      class="results-table"
      :row-key="(r: CommentResult) => `${r.workId}:${r.commentId}`"
    >
      <el-table-column label="昵称" width="68"
        ><template #default="{ row }"
          ><span class="nickname" :title="row.nickname || '未提供'">
            {{ row.nickname || '未提供' }}
          </span></template
        ></el-table-column
      >
      <el-table-column label="评论" min-width="130"
        ><template #default="{ row }"
          ><span class="clamp-two" :title="row.content">{{ row.content }}</span>
          <button
            v-if="source === 'mcp'"
            class="comment-reply-button"
            :disabled="
              replyDisabled || row.reply?.status === 'sent' || row.reply?.status === 'sending'
            "
            :title="replyDisabled ? replyDisabledReason : row.reply?.message || '回复这条评论'"
            :aria-label="`${row.reply?.status === 'sent' ? '已回复' : '回复'} ${row.nickname || '该用户'} 的评论`"
            @click.stop="$emit('reply', row)"
          >
            {{
              row.reply?.status === 'sent'
                ? '已回复'
                : row.reply?.status === 'sending'
                  ? '发送中…'
                  : row.reply?.status === 'unknown'
                    ? '回复待确认'
                    : '回复'
            }}
          </button></template
        ></el-table-column
      >
      <el-table-column label="评论时间" width="96"
        ><template #default="{ row }"
          ><time
            v-if="commentTime(row.publishedAt)"
            :datetime="row.publishedAt"
            class="comment-time"
          >
            {{ commentTime(row.publishedAt)?.date }}<br />{{
              commentTime(row.publishedAt)?.time
            }} </time
          ><span v-else class="comment-time">未提供</span></template
        ></el-table-column
      >
      <template #empty>
        <div class="empty-results">
          <div class="empty-icon"><ChatLineSquare /></div>
          <strong>{{
            !configured
              ? '从一个关键词开始'
              : phase === 'reading'
                ? '正在寻找匹配评论'
                : phase === 'completed'
                  ? '暂未发现匹配评论'
                  : '等待开始采集'
          }}</strong>
          <p>
            {{
              !configured
                ? '请先在设置中填写关键词'
                : source === 'mcp'
                  ? '登录小红书，搜索并获取候选作品'
                  : source === 'demo'
                    ? '演示模式使用虚构作品与评论'
                    : '导入作品后，点击开始采集'
            }}
          </p>
          <button v-if="!configured" class="text-button" @click="$emit('setup')">
            设置关键词 <ArrowRight />
          </button>
        </div>
      </template>
    </el-table>
    <div v-if="total > 50" class="pagination">
      <el-pagination
        :current-page="page"
        :page-size="50"
        :total="total"
        layout="prev, pager, next"
        :pager-count="5"
        small
        @current-change="(p) => $emit('page', p)"
      />
    </div>
  </div>
</template>
