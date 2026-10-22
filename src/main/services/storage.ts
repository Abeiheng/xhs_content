import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  defaults,
  validateSettings,
  validateWorksPerKeyword,
  workTimeRanges
} from '../../shared/rules'
import type { CommentResult, ReplyRecord, SaveResult, Settings, SourceMode } from '../../shared/types'
export class Storage {
  settings: Settings = structuredClone(defaults)
  records: CommentResult[] = []
  replies: ReplyRecord[] = []
  notice = ''
  private keys = new Set<string>()
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true })
    try {
      const path = join(directory, 'settings.json')
      if (existsSync(path)) {
        const saved = JSON.parse(readFileSync(path, 'utf8'))
        if (!['red', 'blue', 'green', 'purple'].includes(saved.theme)) throw new Error('theme')
        if (!Array.isArray(saved.workKeywords) || !Array.isArray(saved.commentKeywords))
          throw new Error('keywords')
        if (!workTimeRanges.includes(saved.workTimeRange ?? '不限')) throw new Error('time range')
        if (saved.workKeywords.length || saved.commentKeywords.length) validateSettings(saved)
        else if (saved.intervalMinutes !== 1) throw new Error('settings')
        this.settings = {
          ...structuredClone(defaults),
          ...saved,
          worksPerKeyword: validateWorksPerKeyword(saved.worksPerKeyword),
          replyIntervalSeconds:
            Number.isInteger(saved.replyIntervalSeconds) && saved.replyIntervalSeconds >= 0
              ? saved.replyIntervalSeconds
              : defaults.replyIntervalSeconds
        }
      }
    } catch {
      this.notice = '配置损坏，已恢复默认设置，请重新填写关键词'
    }
    const path = join(directory, 'results.jsonl')
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8')
      // 隔离上次中断写入的尾行，确保后续追加的记录仍可单独读取。
      if (content && !content.endsWith('\n')) appendFileSync(path, '\n')
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          const row: CommentResult = JSON.parse(line)
          if (
            !row.workId ||
            !row.commentId ||
            typeof row.content !== 'string' ||
            !['mcp', 'import', 'demo'].includes(row.source) ||
            !Array.isArray(row.matchedCommentKeywords) ||
            !Array.isArray(row.matchedWorkKeywords)
          )
            throw new Error('record')
          if (!this.keys.has(this.key(row))) {
            this.keys.add(this.key(row))
            this.records.push(row)
          }
        } catch {
          this.notice = '部分历史结果损坏，已跳过异常记录'
        }
      }
    }
    try {
      const path = join(directory, 'replies.json')
      if (existsSync(path)) {
        const rows = JSON.parse(readFileSync(path, 'utf8'))
        if (
          !Array.isArray(rows) ||
          rows.some(
            (r) =>
              !r.workId ||
              !r.commentId ||
              typeof r.content !== 'string' ||
              !['sending', 'sent', 'unknown'].includes(r.status)
          )
        )
          throw new Error('reply records')
        this.replies = rows.map((r) =>
          r.status === 'sending'
            ? { ...r, status: 'unknown', message: '上次发送被中断，请先到小红书核实是否已回复' }
            : r
        )
      }
    } catch {
      this.notice = '回复记录无法读取，请先核实小红书上的回复状态'
      this.repliesReadable = false
    }
  }
  private repliesReadable = true
  replyRecord(workId: string, commentId: string): ReplyRecord | undefined {
    if (!this.repliesReadable)
      throw new Error('回复记录损坏，请先核实并修复本地回复记录，避免重复发送')
    return this.replies.find((r) => r.workId === workId && r.commentId === commentId)
  }
  saveReply(record: ReplyRecord): void {
    this.replyRecord(record.workId, record.commentId)
    const rows = this.replies.filter(
      (r) => r.workId !== record.workId || r.commentId !== record.commentId
    )
    rows.push(record)
    const path = join(this.directory, 'replies.json')
    writeFileSync(path + '.tmp', JSON.stringify(rows, null, 2))
    renameSync(path + '.tmp', path)
    this.replies = rows
  }
  private key(row: CommentResult): string {
    return JSON.stringify([row.source, row.workId, row.commentId])
  }
  save(settings: Settings): void {
    const path = join(this.directory, 'settings.json')
    writeFileSync(path + '.tmp', JSON.stringify(settings, null, 2))
    renameSync(path + '.tmp', path)
    this.settings = structuredClone(settings)
  }
  clearResults(): void {
    const path = join(this.directory, 'results.jsonl')
    // 先原子替换磁盘数据，成功后才清理内存和去重索引。
    writeFileSync(path + '.tmp', '')
    renameSync(path + '.tmp', path)
    this.records = []
    this.keys.clear()
  }
  append(rows: CommentResult[]): SaveResult {
    const keys = new Set<string>()
    const fresh = rows.filter((row) => {
      const key = this.key(row)
      if (this.keys.has(key) || keys.has(key)) return false
      keys.add(key)
      return true
    })
    if (!fresh.length) return { added: 0, skipped: rows.length }
    appendFileSync(
      join(this.directory, 'results.jsonl'),
      fresh.map((r) => JSON.stringify(r)).join('\n') + '\n'
    )
    fresh.forEach((r) => {
      this.keys.add(this.key(r))
      this.records.push(r)
    })
    return { added: fresh.length, skipped: rows.length - fresh.length }
  }
  page(source: SourceMode, page: number): { rows: CommentResult[]; total: number } {
    const rows = this.records.filter((r) => r.source === source)
    const start = (Math.max(1, Math.floor(page) || 1) - 1) * 50
    return {
      rows: rows.slice(start, start + 50).map((row) => ({
        ...row,
        reply:
          row.source === 'mcp'
            ? this.replies.find((r) => r.workId === row.workId && r.commentId === row.commentId)
            : undefined
      })),
      total: rows.length
    }
  }
}
