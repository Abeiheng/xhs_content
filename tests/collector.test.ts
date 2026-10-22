import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaults,
  parseKeywords,
  safeUrl,
  selectWorks,
  validateSettings
} from '../src/shared/rules'
import { Scheduler } from '../src/main/services/scheduler'
import { Storage } from '../src/main/services/storage'
import { demoWorks, importWorks } from '../src/main/services/sources'
import type { CommentResult, FilterSettings, SourceComment, Work } from '../src/shared/types'
const settings: FilterSettings = {
  workTimeRange: '不限',
  workKeywords: ['装修', '报价'],
  commentKeywords: ['报价', '多少钱', '求推荐'],
  intervalMinutes: 1,
  worksPerKeyword: 10,
  replyIntervalSeconds: 10,
  commentGroups: [],
  activeCommentGroup: 0
}
const comment: SourceComment = {
  id: 'c1',
  content: '多少钱，求推荐',
  nickname: '用户',
  userProfileUrl: null,
  publishedAt: null
}
const works: Work[] = [1, 2].map((n) => ({
  id: String(n),
  title: '装修报价',
  description: '',
  url: null
}))
afterEach(() => vi.useRealTimers())
describe('关键词与作品选择', () => {
  it('每词按自定义数量截取，跨组去重后不补位；校验数量边界', () => {
    const data = [
      { ...works[0], id: 'both', title: '装修报价' },
      { ...works[0], id: 'decoration', title: '装修' },
      { ...works[0], id: 'price', title: '报价' },
      { ...works[0], id: 'extra', title: '装修报价' }
    ]
    const selected = selectWorks(data, ['装修', '报价'], '不限', Date.now(), 2)
    expect(selected.map((w) => w.id)).toEqual(['both', 'decoration', 'price'])
    expect(selected[0].matchedKeywords).toEqual(['装修', '报价'])
    expect(selectWorks(data, ['装修'], '不限', Date.now(), 1)).toHaveLength(1)
    expect(selectWorks(data, ['装修'], '不限', Date.now(), 2000)).toHaveLength(3)
    for (const value of [0, -1, 1.5, 2001, NaN, '20', null])
      expect(() => validateSettings({ ...settings, worksPerKeyword: value as number })).toThrow(
        '数量'
      )
    expect(
      validateSettings({ ...settings, worksPerKeyword: undefined as never }).worksPerKeyword
    ).toBe(10)
  })
  it('按作品时间先筛选再取10个；未知、未来和超范围作品不混入', () => {
    const now = Date.parse('2026-10-22T04:00:00Z')
    const data = [
      { ...works[0], id: 'old', publishedAt: '2026-10-10T04:00:00Z' },
      { ...works[0], id: 'unknown' },
      { ...works[0], id: 'future', publishedAt: '2026-10-23T04:00:00Z' },
      ...Array.from({ length: 12 }, (_, i) => ({
        ...works[0],
        id: `recent-${i}`,
        publishedAt: '2026-10-21T04:00:00Z'
      }))
    ]
    expect(selectWorks(data, ['装修'], '一天内', now).map((w) => w.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `recent-${i}`)
    )
    expect(
      selectWorks([{ ...works[0], searchTimeRange: '一周内' }], ['装修'], '一周内', now)
    ).toHaveLength(1)
    expect(
      selectWorks([{ ...works[0], searchTimeRange: '一周内' }], ['装修'], '一天内', now)
    ).toHaveLength(0)
    expect(() => validateSettings({ ...settings, workTimeRange: '两年内' as never })).toThrow(
      '时间范围'
    )
  })
  it('中英文逗号、空项、重复项和拉丁字母大小写', () => {
    expect(parseKeywords(' 装修，报价,,装修, DIY,diy ')).toEqual(['装修', '报价', 'DIY'])
  })
  it('每词先取10个，3个交集得到17个，不补第11个', () => {
    const queue = selectWorks(demoWorks(), settings.workKeywords)
    expect(queue).toHaveLength(17)
    expect(queue.filter((w) => w.matchedKeywords.includes('装修'))).toHaveLength(10)
    expect(queue.filter((w) => w.matchedKeywords.includes('报价'))).toHaveLength(10)
    expect(queue[7].matchedKeywords).toEqual(['装修', '报价'])
    expect(queue.map((w) => w.id)).toEqual(demoWorks().map((w) => w.id))
  })
  it('同标题不同ID保留；重复ID仅占一个组内名额', () => {
    const data = [
      ...works,
      ...works,
      ...Array.from({ length: 12 }, (_, i) => ({ ...works[0], id: `extra-${i}` }))
    ]
    expect(selectWorks(data, ['装修'])).toHaveLength(10)
    expect(selectWorks([{ ...works[0], title: 'DIY' }], ['diy'])).toHaveLength(1)
    expect(() => selectWorks([{ ...works[0], id: '' }], ['装修'])).toThrow('ID')
  })
  it('阻止无效规则与非 http 链接', () => {
    for (const value of [0, 1.5, 1441, NaN])
      expect(() => validateSettings({ ...settings, intervalMinutes: value })).toThrow()
    expect(validateSettings({ ...settings, workKeywords: [] }).workKeywords).toEqual([])
    for (const url of ['javascript:alert(1)', 'file:///tmp/test', 'https://user:pass@example.com'])
      expect(() => safeUrl(url)).toThrow()
    expect(safeUrl('https://www.xiaohongshu.com/explore')).toContain('https:')
  })
})
describe('串行调度', () => {
  it('采集队列使用已保存数量的任务快照', async () => {
    const rule = { ...settings, worksPerKeyword: 1 }
    const read = vi.fn().mockResolvedValue([comment])
    const task = new Scheduler(
      read,
      () => {},
      () => {}
    )
    task.start(works, rule, 'demo')
    rule.worksPerKeyword = 20
    await Promise.resolve()
    await Promise.resolve()
    expect(task.state.total).toBe(1)
    expect(task.state.phase).toBe('completed')
    expect(read).toHaveBeenCalledTimes(1)
    expect(task.state.groups).toEqual([])
  })
  it('当前作品读取耗时不占等待间隔，暂停等待保留剩余时间，末项立即结束', async () => {
    vi.useFakeTimers()
    const read = vi.fn(
      () => new Promise<SourceComment[]>((resolve) => setTimeout(() => resolve([comment]), 40_000))
    )
    const save = vi.fn()
    const task = new Scheduler(read, save, () => {})
    task.start(works, settings, 'demo')
    await vi.advanceTimersByTimeAsync(40_000)
    expect(task.state.phase).toBe('waiting')
    expect(task.state.remainingSeconds).toBe(60)
    await vi.advanceTimersByTimeAsync(20_000)
    task.pause()
    expect(task.state.remainingSeconds).toBe(40)
    await vi.advanceTimersByTimeAsync(500_000)
    expect(read).toHaveBeenCalledTimes(1)
    task.resume()
    await vi.advanceTimersByTimeAsync(39_999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(task.state.phase).toBe('completed')
    expect(task.state.completed).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(save.mock.calls[0][0][0].matchedCommentKeywords).toEqual(['多少钱', '求推荐'])
  })
  it('读取中暂停：已在途请求可结束，恢复前不保存或调度下一作品', async () => {
    let resolve!: (value: SourceComment[]) => void
    const read = vi.fn(
      () =>
        new Promise<SourceComment[]>((r) => {
          resolve = r
        })
    )
    const save = vi.fn()
    const task = new Scheduler(read, save, () => {})
    task.start(works.slice(0, 1), settings, 'demo')
    task.pause()
    resolve([comment])
    await Promise.resolve()
    expect(task.state.phase).toBe('paused')
    expect(save).not.toHaveBeenCalled()
    task.resume()
    expect(task.state.phase).toBe('completed')
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('读取失败暂停并可重试当前作品；取消后丢弃迟到响应', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('需验证')).mockResolvedValue([comment])
    const task = new Scheduler(
      read,
      () => {},
      () => {}
    )
    task.start(works.slice(0, 1), settings, 'mcp')
    await Promise.resolve()
    await Promise.resolve()
    expect(task.state.phase).toBe('attention')
    expect(task.state.completed).toBe(0)
    task.resume()
    await Promise.resolve()
    await Promise.resolve()
    expect(task.state.phase).toBe('completed')
    expect(read).toHaveBeenCalledTimes(2)
    let resolve!: (rows: SourceComment[]) => void
    const save = vi.fn()
    const late = new Scheduler(
      () =>
        new Promise((r) => {
          resolve = r
        }),
      save,
      () => {}
    )
    late.start(works, settings, 'mcp')
    late.stop()
    resolve([comment])
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    expect(late.state.completed).toBe(0)
  })
  it('保存失败可重试，不重复读取；无匹配作品不建定时器', async () => {
    const read = vi.fn().mockResolvedValue([comment])
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const task = new Scheduler(read, save, () => {})
    task.start(works.slice(0, 1), settings, 'import')
    await Promise.resolve()
    await Promise.resolve()
    expect(task.state.phase).toBe('attention')
    task.resume()
    expect(task.state.phase).toBe('completed')
    expect(read).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    task.start([], settings, 'demo')
    expect(task.state.total).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('无匹配评论也等待；任务使用规则快照', async () => {
    vi.useFakeTimers()
    const rule = structuredClone(settings)
    const save = vi.fn()
    const task = new Scheduler(
      async () => [{ ...comment, content: '收藏了' }],
      save,
      () => {}
    )
    task.start(works, rule, 'import')
    rule.intervalMinutes = 2
    await Promise.resolve()
    await Promise.resolve()
    expect(save.mock.calls[0][0]).toEqual([])
    expect(task.state.phase).toBe('waiting')
    expect(task.state.remainingSeconds).toBe(60)
    task.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
describe('导入与持久化', () => {
  it('自定义每词数量跨重启保留，旧配置缺失数量时补全默认10', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xhs-quantity-'))
    try {
      const store = new Storage(directory)
      store.save({ ...settings, theme: 'purple', worksPerKeyword: 50 })
      expect(new Storage(directory).settings.worksPerKeyword).toBe(50)
      const legacy = { ...store.settings } as Partial<typeof store.settings>
      delete legacy.worksPerKeyword
      writeFileSync(join(directory, 'settings.json'), JSON.stringify(legacy))
      const restored = new Storage(directory)
      expect(restored.settings.worksPerKeyword).toBe(10)
      expect(restored.settings.theme).toBe('purple')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('重置清空所有来源结果和去重索引，重启保留设置及回复记录；写入失败不清空', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xhs-reset-'))
    try {
      const store = new Storage(directory)
      store.save({ ...settings, theme: 'blue', workTimeRange: '一天内' })
      const row: CommentResult = {
        workId: 'w-reset',
        commentId: 'c-reset',
        content: '报价',
        nickname: null,
        userProfileUrl: null,
        workTitle: null,
        workUrl: null,
        matchedWorkKeywords: ['报价'],
        matchedCommentKeywords: ['报价'],
        publishedAt: null,
        collectedAt: new Date().toISOString(),
        source: 'mcp'
      }
      store.append([row, { ...row, source: 'demo' }, { ...row, source: 'import' }])
      store.saveReply({
        workId: row.workId,
        commentId: row.commentId,
        content: '已回复正文',
        status: 'sent',
        updatedAt: new Date().toISOString(),
        message: '回复成功'
      })
      // 模拟写盘失败，不能先清理内存或破坏已有磁盘结果。
      mkdirSync(join(directory, 'results.jsonl.tmp'))
      expect(() => store.clearResults()).toThrow()
      expect(store.records).toHaveLength(3)
      expect(new Storage(directory).records).toHaveLength(3)
      rmSync(join(directory, 'results.jsonl.tmp'), { recursive: true })
      store.clearResults()
      expect(store.records).toHaveLength(0)
      const restored = new Storage(directory)
      expect(restored.records).toHaveLength(0)
      expect(restored.settings).toEqual(store.settings)
      expect(restored.replyRecord(row.workId, row.commentId)?.status).toBe('sent')
      store.append([row, row])
      expect(store.page('mcp', 1).total).toBe(1)
      expect(store.page('mcp', 1).rows[0].reply?.status).toBe('sent')
      expect(new Storage(directory).records).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('旧配置自动补全不限，新时间范围可持久化，导入保留作品发布时间', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xhs-range-'))
    try {
      const legacy = Object.fromEntries(
        Object.entries(settings).filter(([key]) => key !== 'workTimeRange')
      )
      writeFileSync(join(directory, 'settings.json'), JSON.stringify({ ...legacy, theme: 'red' }))
      const store = new Storage(directory)
      expect(store.settings.workTimeRange).toBe('不限')
      store.save({ ...store.settings, workTimeRange: '一周内' })
      expect(new Storage(directory).settings.workTimeRange).toBe('一周内')
      expect(
        importWorks([{ ...works[0], publishedAt: '2026-10-22T04:00:00Z', comments: [] }])[0]
          .publishedAt
      ).toBe('2026-10-22T04:00:00Z')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('校验作品和评论稳定ID，允许同用户不同评论', () => {
    expect(() => importWorks({ works: [{ title: '缺少ID', comments: [] }] })).toThrow()
    expect(() => importWorks([...works, ...works].map((w) => ({ ...w, comments: [] })))).toThrow(
      '重复'
    )
    expect(importWorks(demoWorks())).toHaveLength(17)
  })
  it('跨重启保存设置与结果，按来源、作品ID+评论ID去重，损坏配置恢复默认值', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xhs-test-'))
    try {
      const store = new Storage(directory)
      store.save({ ...settings, theme: 'blue' })
      const row: CommentResult = {
        workId: 'w1',
        commentId: 'c1',
        content: '多少钱',
        nickname: '同一个人',
        userProfileUrl: null,
        workTitle: '装修',
        workUrl: null,
        matchedWorkKeywords: ['装修'],
        matchedCommentKeywords: ['多少钱'],
        publishedAt: null,
        collectedAt: new Date().toISOString(),
        source: 'mcp'
      }
      store.append([row, row, { ...row, commentId: 'c2' }, { ...row, source: 'demo' }])
      const restored = new Storage(directory)
      expect(restored.settings.theme).toBe('blue')
      expect(restored.page('mcp', 1).total).toBe(2)
      expect(restored.page('demo', 1).total).toBe(1)
      expect(
        readFileSync(join(directory, 'results.jsonl'), 'utf8').trim().split('\n')
      ).toHaveLength(3)
      writeFileSync(join(directory, 'settings.json'), '{bad')
      expect(new Storage(directory).settings).toEqual(defaults)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
