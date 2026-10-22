import { describe, expect, it, vi } from 'vitest'
import {
  McpSource,
  normalizeComments,
  normalizeFeeds,
  normalizeProfile
} from '../src/main/services/mcp-source'
import type { IntegrationState, Work } from '../src/shared/types'
const status = (): IntegrationState => ({
  visibleBrowser: false,
  managed: true,
  status: 'ready',
  message: '',
  loggedIn: true,
  username: null,
  operation: null
})
const feed = {
  id: 'note-1',
  modelType: 'note',
  xsecToken: 'sample-token',
  noteCard: { displayTitle: '装修报价' }
}
const work: Work = {
  id: 'note-1',
  title: '装修报价',
  description: '',
  url: null,
  xsecToken: 'sample-token'
}
const comment = {
  id: 'comment-1',
  content: '报价多少钱',
  createTime: 1700000000000,
  userInfo: { userId: 'user-1', nickname: '公开用户' },
  subComments: []
}
const detail = {
  feed_id: 'note-1',
  data: { note: { noteId: 'note-1' }, comments: { hasMore: false, list: [comment] } }
}
const response = (data: unknown, statusCode = 200): Response =>
  new Response(
    JSON.stringify({
      success: statusCode === 200,
      data,
      error: statusCode === 200 ? undefined : '需要登录'
    }),
    { status: statusCode }
  )
function source(fetcher: ReturnType<typeof vi.fn>, state = status()): McpSource {
  return new McpSource(
    () => 'http://127.0.0.1:12345',
    () => 'test-token',
    state,
    () => {},
    fetcher as typeof fetch
  )
}
describe('xiaohongshu-mcp v2.5.5 数据合同', () => {
  it('搜索结构 camelCase；过滤非作品和缺少签名的项目，保留顺序', () => {
    const works = normalizeFeeds({
      feeds: [
        feed,
        { ...feed, id: 'ad', modelType: 'live_v2' },
        { ...feed, id: 'missing', xsecToken: '' }
      ]
    })
    expect(works).toHaveLength(1)
    expect(works[0]).toMatchObject({ id: 'note-1', title: '装修报价', xsecToken: 'sample-token' })
    expect(works[0].url).toContain('xsec_token=sample-token')
    expect(() => normalizeFeeds({ items: [] })).toThrow('响应格式')
  })
  it('详情双层 data、评论去重、回复、全部未知值与明确的采集范围', () => {
    const selected = { ...work }
    const rows = normalizeComments(
      {
        ...detail,
        data: {
          ...detail.data,
          comments: {
            hasMore: false,
            list: [
              { ...comment, subComments: [{ id: 'reply-1', content: '求推荐', userInfo: {} }] },
              comment
            ]
          }
        }
      },
      selected
    )
    expect(rows.map((r) => r.id)).toEqual(['comment-1', 'reply-1'])
    expect(rows[0]).toMatchObject({
      nickname: '公开用户',
      publishedAt: '2023-11-14T22:13:20.000Z',
      userId: 'user-1',
      userXsecToken: 'sample-token'
    })
    expect(rows[1]).toMatchObject({ nickname: null, publishedAt: null })
    expect(selected.collectionScope).toContain('列表末尾')
    expect(() =>
      normalizeComments({ data: { ...detail.data, note: { noteId: 'wrong' } } }, work)
    ).toThrow('作品不一致')
    expect(() =>
      normalizeComments(
        { data: { ...detail.data, comments: { hasMore: false, list: [{ content: 'no id' }] } } },
        work
      )
    ).toThrow('稳定 ID')
  })
  it('未到读取范围且还有分页时暂停，达到范围后严格截取200条一级评论', () => {
    expect(() =>
      normalizeComments(
        { ...detail, data: { ...detail.data, comments: { hasMore: true, list: [comment] } } },
        { ...work }
      )
    ).toThrow('尚未读取至设定范围')
    const many = Array.from({ length: 205 }, (_, i) => ({ ...comment, id: `c-${i}` }))
    const selected = { ...work }
    expect(
      normalizeComments(
        { ...detail, data: { ...detail.data, comments: { hasMore: true, list: many } } },
        selected
      )
    ).toHaveLength(200)
    expect(selected.collectionScope).toContain('平台仍有更多评论')
  })
  it('用户资料双层 data，不猜测未知字段', () => {
    const profile = normalizeProfile({
      data: {
        userBasicInfo: { nickname: '公开昵称', desc: '简介', redId: 'red-1' },
        interactions: [{ name: '粉丝', count: '12' }],
        feeds: [feed]
      }
    })
    expect(profile).toMatchObject({
      nickname: '公开昵称',
      description: '简介',
      location: null,
      interactions: [{ name: '粉丝', count: '12' }]
    })
    expect(profile.works).toHaveLength(1)
  })
})
describe('MCP 工具调用', () => {
  it('作品时间范围使用上游 publish_time 筛选，并在候选上保留已验证范围', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ feeds: [feed] }))
    const mcp = source(fetcher)
    await mcp.search('软件开发', '一周内')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      keyword: '软件开发',
      filters: { publish_time: '一周内' }
    })
    expect(mcp.works.get(feed.id)?.searchTimeRange).toBe('一周内')
  })
  it('搜索遇到上游内部错误有限重试，成功后保留真实候选作品', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ code: 'INTERNAL_ERROR', error: '服务器内部错误', details: {} }),
            { status: 500 }
          )
        )
        .mockResolvedValueOnce(response({ feeds: [feed] }))
      const state = status()
      const mcp = source(fetcher, state)
      const search = mcp.search('软件开发')
      await vi.runAllTimersAsync()
      await search
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(mcp.works.size).toBe(1)
      expect(state.operation).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
  it('连续失败最多请求两次，保留旧候选并给出可操作提示', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: 'INTERNAL_ERROR', error: '服务器内部错误' }), {
            status: 500
          })
      )
      const mcp = source(fetcher)
      mcp.works.set(work.id, work)
      const assertion = expect(mcp.search('软件开发')).rejects.toThrow('已自动重试一次')
      await vi.runAllTimersAsync()
      await assertion
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(mcp.works.size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('搜索请求带鉴权，关键词独立传参，多次搜索稳定去重', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ feeds: [feed] }))
    const mcp = source(fetcher)
    await mcp.search('装修')
    fetcher.mockResolvedValue(
      response({ feeds: [{ ...feed, noteCard: { displayTitle: '更新的标题' } }] })
    )
    await mcp.search('报价')
    expect(mcp.works.size).toBe(1)
    expect(mcp.works.get('note-1')?.title).toBe('更新的标题')
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:12345/api/v1/feeds/search')
    expect(JSON.parse(options.body)).toEqual({ keyword: '装修' })
    expect(options.headers.Authorization).toBe('Bearer test-token')
  })
  it('显式加载200条一级评论，不误用默认10条，保留主页凭证', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(detail))
    const mcp = source(fetcher)
    const rows = await mcp.read({ ...work }, new AbortController().signal)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      feed_id: 'note-1',
      xsec_token: 'sample-token',
      load_all_comments: true,
      comment_config: { max_comment_items: 200, click_more_replies: false, scroll_speed: 'slow' }
    })
  })
  it('二维码和登录状态调用；二维码仅接受图片 data URL', async () => {
    const state = status()
    state.loggedIn = false
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ is_logged_in: false, img: 'data:image/png;base64,YWJj' }))
      .mockResolvedValueOnce(response({ is_logged_in: true, username: '测试账号' }))
    const mcp = source(fetcher, state)
    expect((await mcp.loginQr()).image).toBe('data:image/png;base64,YWJj')
    await mcp.loginStatus()
    expect(state.loggedIn).toBe(true)
    expect(state.username).toBe('测试账号')
    fetcher.mockResolvedValue(
      response({ is_logged_in: false, img: 'data:image/svg+xml;base64,YWJj' })
    )
    await expect(mcp.loginQr()).rejects.toThrow('二维码格式')
  })
  it('未登录禁止搜索；错误不伪装成功；任务取消中止请求', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, 500))
    const state = status()
    state.loggedIn = false
    const mcp = source(fetcher, state)
    await expect(mcp.search('装修')).rejects.toThrow('先扫码')
    expect(fetcher).not.toHaveBeenCalled()
    state.loggedIn = true
    await expect(mcp.search('装修')).rejects.toThrow('需要登录')
    const controller = new AbortController()
    controller.abort()
    await expect(mcp.read(work, controller.signal)).rejects.toThrow('已取消')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('后台调用串行排队，不并发开启多个读取操作', async () => {
    let resolve!: (r: Response) => void
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolve = r
          })
      )
      .mockResolvedValue(response({ feeds: [feed] }))
    const mcp = source(fetcher)
    const first = mcp.search('装修')
    const second = mcp.search('报价')
    await Promise.resolve()
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    resolve(response({ feeds: [feed] }))
    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
