import { includes, selectWorks, validateSettings } from '../../shared/rules'
import type {
  CommentResult,
  FilterSettings,
  SelectedWork,
  SourceComment,
  SourceMode,
  TaskState,
  Work,
  SaveResult
} from '../../shared/types'
export interface Clock {
  now(): number
  set(callback: () => void, ms: number): unknown
  clear(timer: unknown): void
}
const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
}
export class Scheduler {
  state: TaskState = {
    phase: 'idle',
    total: 0,
    completed: 0,
    currentTitle: '',
    currentKeywords: [],
    remainingSeconds: 0,
    message: '尚未开始',
    groups: []
  }
  private queue: SelectedWork[] = []
  private settings!: FilterSettings
  private controller?: AbortController
  private timer: unknown
  private deadline = 0
  private remainingMs = 0
  private beforePause: 'reading' | 'waiting' = 'reading'
  private generation = 0
  private pending?: SourceComment[]
  private inFlight = false
  private source: SourceMode = 'mcp'
  constructor(
    private read: (work: Work, signal: AbortSignal) => Promise<SourceComment[]>,
    private save: (rows: CommentResult[]) => SaveResult | void,
    private changed: () => void,
    private clock: Clock = realClock
  ) {}
  get active(): boolean {
    return ['reading', 'waiting', 'paused', 'attention'].includes(this.state.phase)
  }
  reset(): void {
    if (this.active) throw new Error('请先结束当前任务')
    this.state = {
      phase: 'idle',
      total: 0,
      completed: 0,
      currentTitle: '',
      currentKeywords: [],
      remainingSeconds: 0,
      message: '尚未开始',
      groups: []
    }
    this.changed()
  }
  start(works: Work[], settings: FilterSettings, source: SourceMode): void {
    if (this.active) throw new Error('请先结束当前任务')
    this.settings = structuredClone(validateSettings(settings))
    this.queue = structuredClone(
      selectWorks(
        works,
        [],
        this.settings.workTimeRange,
        this.clock.now(),
        this.settings.worksPerKeyword
      )
    )
    this.source = source
    this.generation++
    this.pending = undefined
    this.state = {
      phase: this.queue.length ? 'reading' : 'completed',
      total: this.queue.length,
      completed: 0,
      currentTitle: '',
      currentKeywords: [],
      remainingSeconds: 0,
      message: this.queue.length ? '正在读取评论' : '没有匹配作品，请检查关键词及作品时间范围',
      groups: []
    }
    if (this.queue.length) void this.process()
    else this.changed()
  }
  private async process(): Promise<void> {
    const generation = this.generation
    const work = this.queue[this.state.completed]
    this.state.phase = 'reading'
    this.state.currentTitle = work.title
    this.state.currentKeywords = work.matchedKeywords
    this.state.remainingSeconds = 0
    this.state.message = '正在读取评论'
    this.controller = new AbortController()
    this.inFlight = true
    this.changed()
    try {
      const comments = await this.read(work, this.controller.signal)
      if (generation !== this.generation) return
      this.pending = comments
      if (this.state.phase === 'reading') this.finishWork()
    } catch (error) {
      if (generation !== this.generation) return
      this.state.phase = 'attention'
      this.state.message =
        error instanceof Error ? error.message : '读取失败，请检查小红书窗口后重试'
      this.changed()
    } finally {
      if (generation === this.generation) this.inFlight = false
    }
  }
  private finishWork(): void {
    const work = this.queue[this.state.completed]
    try {
      const rows = (this.pending ?? []).flatMap((comment): CommentResult[] => {
        const group = this.settings.commentGroups?.[this.settings.activeCommentGroup || 0]
        const includeKeywords = group?.include || this.settings.commentKeywords
        const excludes = group?.exclude || []
        if (excludes.some((keyword) => includes(comment.content, keyword))) return []
        const hits = includeKeywords.filter((keyword) => includes(comment.content, keyword))
        if (!hits.length) return []
        return [
          {
            workId: work.id,
            workXsecToken: work.xsecToken,
            userId: comment.userId,
            userXsecToken: comment.userXsecToken,
            collectionScope: work.collectionScope,
            commentId: comment.id,
            content: comment.content,
            nickname: comment.nickname,
            userProfileUrl: comment.userProfileUrl,
            workTitle: work.title || null,
            workUrl: work.url,
            matchedWorkKeywords: work.matchedKeywords,
            matchedCommentKeywords: hits,
            publishedAt: comment.publishedAt,
            collectedAt: new Date(this.clock.now()).toISOString(),
            source: this.source
          }
        ]
      })
      const saved = this.save(rows)
      this.pending = undefined
      this.state.completed++
      this.state.groups.forEach((g) => {
        if (work.matchedKeywords.includes(g.keyword)) g.completed++
      })
      if (this.state.completed === this.state.total) {
        this.state.phase = 'completed'
        this.state.message =
          saved && saved.skipped > 0
            ? `采集完成，本次新增 ${saved.added} 条，${saved.skipped} 条已存在`
            : '采集完成'
        this.state.remainingSeconds = 0
        this.changed()
      } else {
        this.remainingMs = this.settings.intervalMinutes * 60_000
        this.beginWait()
      }
    } catch {
      this.state.phase = 'attention'
      this.state.message = '结果保存失败，请检查磁盘空间后重试'
      this.changed()
    }
  }
  private beginWait(): void {
    this.state.phase = 'waiting'
    this.state.message = '等待下一个作品'
    this.deadline = this.clock.now() + this.remainingMs
    this.tick()
  }
  private tick = (): void => {
    if (this.state.phase !== 'waiting') return
    this.remainingMs = Math.max(0, this.deadline - this.clock.now())
    this.state.remainingSeconds = Math.ceil(this.remainingMs / 1000)
    if (!this.remainingMs) {
      void this.process()
      return
    }
    this.changed()
    this.timer = this.clock.set(this.tick, Math.min(1000, this.remainingMs))
  }
  pause(): void {
    if (!['reading', 'waiting'].includes(this.state.phase)) return
    this.beforePause = this.state.phase as 'reading' | 'waiting'
    if (this.beforePause === 'waiting') {
      this.remainingMs = Math.max(0, this.deadline - this.clock.now())
      this.clock.clear(this.timer)
      this.state.remainingSeconds = Math.ceil(this.remainingMs / 1000)
    }
    this.state.phase = 'paused'
    this.state.message = '已暂停'
    this.changed()
  }
  resume(): void {
    if (this.state.phase === 'attention') {
      if (this.inFlight) return
      if (this.pending) this.finishWork()
      else void this.process()
    } else if (this.state.phase === 'paused') {
      if (this.beforePause === 'waiting') this.beginWait()
      else if (this.pending) {
        this.state.phase = 'reading'
        this.finishWork()
      } else {
        this.state.phase = 'reading'
        this.state.message = '正在读取评论'
        this.changed()
      }
    }
  }
  stop(): void {
    this.generation++
    this.controller?.abort()
    this.clock.clear(this.timer)
    this.pending = undefined
    this.inFlight = false
    if (this.active) {
      this.state.phase = 'completed'
      this.state.message = '任务已结束，结果已保留'
      this.state.remainingSeconds = 0
      this.changed()
    }
  }
  suspend(): void {
    this.pause()
  }
}
