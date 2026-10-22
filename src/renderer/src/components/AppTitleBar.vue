<script setup lang="ts">
import { ChatDotRound, Close, Present, RefreshLeft, Setting } from '@element-plus/icons-vue'
defineProps<{ pinned: boolean; settings: boolean; resetDisabled: boolean }>()
defineEmits<{
  pin: []
  settings: []
  close: []
  reset: []
  support: [mode: 'donation' | 'feedback']
}>()
</script>
<template>
  <header class="titlebar">
    <div class="brand"><i></i><span>测试软件</span></div>
    <nav aria-label="窗口操作">
      <el-tooltip content="打赏" :show-after="450">
        <button class="icon-button" aria-label="打赏" @click="$emit('support', 'donation')">
          <Present />
        </button>
      </el-tooltip>
      <el-tooltip content="投诉建议" :show-after="450">
        <button class="icon-button" aria-label="投诉建议" @click="$emit('support', 'feedback')">
          <ChatDotRound />
        </button>
      </el-tooltip>
      <el-tooltip content="重置采集" :show-after="450">
        <button
          class="icon-button"
          aria-label="重置采集"
          :disabled="resetDisabled"
          @click="$emit('reset')"
        >
          <RefreshLeft />
        </button>
      </el-tooltip>
      <el-tooltip :content="pinned ? '取消置顶' : '窗口置顶'" :show-after="450">
        <button
          class="icon-button pin"
          :class="{ active: pinned }"
          :aria-pressed="pinned"
          aria-label="窗口置顶"
          @click="$emit('pin')"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3h8M9 3v7l-4 5h14l-4-5V3M12 15v6" />
          </svg>
        </button>
      </el-tooltip>
      <el-tooltip content="设置" :show-after="450"
        ><button
          class="icon-button"
          :class="{ active: settings }"
          aria-label="设置"
          @click="$emit('settings')"
        >
          <Setting /></button
      ></el-tooltip>
      <el-tooltip content="关闭" :show-after="450"
        ><button class="icon-button close" aria-label="关闭" @click="$emit('close')">
          <Close /></button
      ></el-tooltip>
    </nav>
  </header>
</template>
