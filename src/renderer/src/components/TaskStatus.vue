<script setup lang="ts">
import { computed } from 'vue'
import type { Settings, TaskState } from '../../../shared/types'
const props = defineProps<{ task: TaskState; settings: Settings }>()
const countdown = computed(
  () =>
    `${String(Math.floor(props.task.remainingSeconds / 60)).padStart(2, '0')}:${String(props.task.remainingSeconds % 60).padStart(2, '0')}`
)
</script>
<template>
  <div class="task-card" :class="{ 'needs-attention': task.phase === 'attention' }" role="status">
    <div class="task-line">
      <strong
        ><i v-if="task.phase === 'reading'" class="status-dot pulse"></i>{{ task.message }}</strong
      ><span class="task-number">{{
        task.phase === 'waiting' || (task.phase === 'paused' && task.remainingSeconds)
          ? countdown
          : task.total
            ? `作品 ${Math.min(task.completed + (task.phase === 'reading' ? 1 : 0), task.total)} / ${task.total}`
            : '准备就绪'
      }}</span>
    </div>
    <div class="task-meta" :title="task.currentTitle || '搜索候选作品'">
      候选作品按搜索标题筛选 · 本次采集 {{ settings.worksPerKeyword }} 个
    </div>
    <el-tooltip
      v-if="task.groups.length"
      :content="
        task.groups.map((g) => `${g.keyword}：完成 ${g.completed}/${g.selected}`).join('；')
      "
      placement="bottom"
      ><div class="task-progress">
        <span
          :style="{ width: `${task.total ? (task.completed / task.total) * 100 : 0}%` }"
        ></span></div
    ></el-tooltip>
  </div>
</template>
