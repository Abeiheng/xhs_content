import { replyToken, validateReplyContent } from '../../shared/rules'
import type { ReplyRecord } from '../../shared/types'
import type { McpSource } from './mcp-source'
import type { Storage } from './storage'

export class Replies {
  busy = false
  constructor(
    private storage: Storage,
    private mcp: Pick<McpSource, 'reply'>,
    private intervalSeconds: () => number = () => 0
  ) {}
  async send(workId: string, commentId: string, value: string): Promise<ReplyRecord> {
    if (this.busy) throw new Error('正在发送回复，请勿重复点击')
    const content = validateReplyContent(value)
    const row = this.storage.records.find(
      (r) => r.source === 'mcp' && r.workId === workId && r.commentId === commentId
    )
    if (!row) throw new Error('未找到真实采集的目标评论')
    replyToken(row)
    if (this.storage.replyRecord(workId, commentId)?.status === 'sent')
      throw new Error('此评论已经回复，请勿重复发送')
    this.busy = true
    let record: ReplyRecord = {
      workId,
      commentId,
      content,
      status: 'sending',
      updatedAt: new Date().toISOString(),
      message: '正在发送回复'
    }
    try {
      const interval = Math.max(0, this.intervalSeconds()) * 1000
      const latest = this.storage.replies
        .filter((r) => r.status === 'sent')
        .map((r) => Date.parse(r.updatedAt))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0]
      const wait = latest ? latest + interval - Date.now() : 0
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      // 先落盘再调用平台；中途关闭应用时，下次启动显示结果待确认。
      this.storage.saveReply(record)
      try {
        await this.mcp.reply(row, content)
        record = {
          ...record,
          status: 'sent',
          message: '回复成功',
          updatedAt: new Date().toISOString()
        }
      } catch {
        record = {
          ...record,
          status: 'unknown',
          message: '发送结果未确认，请先打开原作品核实，避免重复回复',
          updatedAt: new Date().toISOString()
        }
      }
      try {
        this.storage.saveReply(record)
      } catch {
        record = {
          ...record,
          message:
            record.status === 'sent'
              ? '平台已确认回复，但本地状态保存失败，请勿重复发送'
              : '发送结果和本地状态未确认，请先打开原作品核实'
        }
        // 内存中保留结果；磁盘上的 sending 记录重启后会转为 unknown。
        this.storage.replies = this.storage.replies
          .filter((r) => r.workId !== workId || r.commentId !== commentId)
          .concat(record)
      }
      return record
    } finally {
      this.busy = false
    }
  }
}
