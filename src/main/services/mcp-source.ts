import type {
  IntegrationState,
  LoginQr,
  PublicProfile,
  SourceComment,
  CommentResult,
  Work,
  WorkTimeRange
} from '../../shared/types'
import { workTimeRanges, replyToken, validateReplyContent } from '../../shared/rules'
export type Json = Record<string, unknown>
export const object = (value: unknown): Json =>
  value && typeof value === 'object' ? (value as Json) : {}
export const string = (value: unknown): string => (typeof value === 'string' ? value : '')
const nullable = (value: unknown): string | null => string(value) || null
class McpRequestError extends Error {
  constructor(
    message: string,
    readonly retryableSearch: boolean
  ) {
    super(message)
  }
}
export function normalizeFeeds(data: unknown): Work[] {
  const raw = object(data)
  if (raw.feeds === null) return []
  if (!Array.isArray(raw.feeds)) throw new Error('搜索响应格式已变化，未找到作品列表')
  return raw.feeds.flatMap((item): Work[] => {
    const feed = object(item)
    if (feed.modelType && feed.modelType !== 'note') return []
    const card = object(feed.noteCard)
    const id = string(feed.id)
    const token = string(feed.xsecToken)
    if (!id || !token) return []
    const url = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`)
    url.searchParams.set('xsec_token', token)
    url.searchParams.set('xsec_source', 'pc_search')
    return [
      {
        id,
        title: string(card.displayTitle),
        description: string(card.desc),
        xsecToken: token,
        url: url.href
      }
    ]
  })
}
export function normalizeComments(data: unknown, work: Work): SourceComment[] {
  const details = object(object(data).data)
  const note = object(details.note)
  const comments = object(details.comments)
  if (
    string(note.noteId) !== work.id ||
    !Array.isArray(comments.list) ||
    typeof comments.hasMore !== 'boolean'
  )
    throw new Error('评论响应格式异常或作品不一致，请更新接入服务后重试')
  const rows = new Map<string, SourceComment>()
  const add = (value: unknown): void => {
    const raw = object(value),
      user = object(raw.userInfo)
    const id = string(raw.id)
    if (!id || typeof raw.content !== 'string')
      throw new Error('评论缺少稳定 ID 或正文，读取已暂停')
    const userId = nullable(user.userId)
    const token = nullable(user.xsecToken) || work.xsecToken || null
    const timestamp =
      typeof raw.createTime === 'number' && raw.createTime > 0 ? raw.createTime : NaN
    const time = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
    const url = userId
      ? new URL(`https://www.xiaohongshu.com/user/profile/${encodeURIComponent(userId)}`)
      : null
    if (url && token) {
      url.searchParams.set('xsec_token', token)
      url.searchParams.set('xsec_source', 'pc_note')
    }
    rows.set(id, {
      id,
      content: raw.content,
      nickname: nullable(user.nickname) || nullable(user.nickName),
      userId,
      userXsecToken: token,
      userProfileUrl: url?.href || null,
      publishedAt: Number.isFinite(time.getTime()) ? time.toISOString() : null
    })
    if (Array.isArray(raw.subComments)) raw.subComments.forEach(add)
  }
  const parentIds = comments.list.map((value) => {
    const id = string(object(value).id)
    if (!id) throw new Error('评论缺少稳定 ID，读取已暂停')
    return id
  })
  const uniqueIds = [...new Set(parentIds)]
  if (comments.hasMore && uniqueIds.length < 200)
    throw new Error(
      `评论尚未读取至设定范围（已返回 ${uniqueIds.length} 条），请检查页面验证或加载状态后重试`
    )
  const selectedIds = new Set(uniqueIds.slice(0, 200))
  comments.list.forEach((value, index) => {
    if (selectedIds.has(parentIds[index])) add(value)
  })
  // 范围是明确配置的最多200条一级评论以及响应中已提供的回复，不承诺平台全部评论。
  work.collectionScope = `最多 200 条一级评论，含实际返回的回复${comments.hasMore ? '；平台仍有更多评论' : '；已到当前可用列表末尾'}`
  return [...rows.values()]
}
export function normalizeProfile(data: unknown): PublicProfile {
  const profile = object(object(data).data)
  const basic = object(profile.userBasicInfo)
  if (
    !profile.userBasicInfo ||
    !Array.isArray(profile.interactions) ||
    !Array.isArray(profile.feeds)
  )
    throw new Error('用户主页响应格式已变化')
  return {
    nickname: nullable(basic.nickname),
    redId: nullable(basic.redId),
    description: nullable(basic.desc),
    location: nullable(basic.ipLocation),
    interactions: profile.interactions.map((v) => {
      const entry = object(v)
      return { name: string(entry.name), count: string(entry.count) }
    }),
    works: normalizeFeeds({ feeds: profile.feeds })
      .slice(0, 20)
      .map(({ id, title, url }) => ({ id, title, url }))
  }
}
export class McpSource {
  works = new Map<string, Work>()
  private tail: Promise<unknown> = Promise.resolve()
  private controllers = new Set<AbortController>()
  constructor(
    private origin: () => string,
    private token: () => string,
    private integration: IntegrationState,
    private changed: () => void,
    private fetcher: typeof fetch = fetch
  ) {}
  private async request(
    path: string,
    label: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs = 240_000
  ): Promise<unknown> {
    const operation = async (): Promise<unknown> => {
      if (signal?.aborted) throw new Error('任务已取消')
      if (this.integration.status !== 'ready') throw new Error('请先在小红书接入页启动服务')
      this.integration.operation = label
      this.changed()
      const controller = new AbortController()
      this.controllers.add(controller)
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const abort = (): void => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await this.fetcher(`${this.origin()}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token()}` },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal
        })
        const raw = object(await response.json())
        if (!response.ok || raw.success !== true) {
          if (response.status === 401) throw new Error('采集服务鉴权失败，请重启应用后重试')
          if (raw.code === 'SEARCH_FEEDS_FAILED' && /手动验证/.test(string(raw.details)))
            throw new Error('搜索页面需要验证，请开启“显示采集浏览器”，完成页面验证后重新搜索')
          throw new McpRequestError(
            `${nullable(raw.error) || '采集服务调用失败'}，请检查登录与页面验证后重试`,
            response.status === 500 &&
              (raw.code === 'INTERNAL_ERROR' ||
                (raw.code === 'SEARCH_FEEDS_FAILED' &&
                  /context deadline exceeded|timeout/i.test(string(raw.details))))
          )
        }
        return raw.data
      } catch (error) {
        if (signal?.aborted) throw new Error('任务已取消', { cause: error })
        if (controller.signal.aborted)
          throw new Error('读取超时，任务已暂停；请检查登录与验证状态后重试', { cause: error })
        if (error instanceof TypeError)
          throw new Error('采集服务连接中断，请重新启动服务', { cause: error })
        throw error
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        this.controllers.delete(controller)
        this.integration.operation = null
        this.changed()
      }
    }
    const next = this.tail.then(operation, operation)
    this.tail = next.catch(() => {})
    return next
  }
  async loginStatus(): Promise<void> {
    const data = object(await this.request('/api/v1/login/status', '检查登录状态'))
    if (typeof data.is_logged_in !== 'boolean') throw new Error('登录状态响应异常')
    this.integration.loggedIn = data.is_logged_in
    this.integration.username = nullable(data.username)
    this.changed()
  }
  async loginQr(): Promise<LoginQr> {
    const data = object(await this.request('/api/v1/login/qrcode', '获取登录二维码'))
    if (typeof data.is_logged_in !== 'boolean') throw new Error('二维码响应异常')
    this.integration.loggedIn = data.is_logged_in
    let image = nullable(data.img)
    if (image && !image.startsWith('data:image/')) image = `data:image/png;base64,${image}`
    if (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image))
      throw new Error('服务返回的二维码格式无效')
    this.changed()
    return {
      image,
      loggedIn: data.is_logged_in,
      expiresAt: data.is_logged_in ? null : new Date(Date.now() + 240_000).toISOString()
    }
  }
  async search(query: string, timeRange: WorkTimeRange = '不限'): Promise<void> {
    if (!workTimeRanges.includes(timeRange)) throw new Error('作品时间范围无效')
    if (typeof query !== 'string' || !query.trim() || query.length > 100)
      throw new Error('请输入 1–100 字的搜索内容')
    if (this.integration.loggedIn !== true) throw new Error('请先扫码登录并检查登录状态')
    let works: Work[] = []
    // 上游网页等待可能偶发超时并返回 INTERNAL_ERROR；只对只读搜索有限重试一次。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await this.request(
          '/api/v1/feeds/search',
          attempt ? '页面加载异常，正在重试搜索（1/1）' : '搜索作品',
          {
            keyword: query.trim(),
            ...(timeRange === '不限' ? {} : { filters: { publish_time: timeRange } })
          }
        )
        if (object(data).feeds === null) throw new McpRequestError('搜索页未返回作品数据', true)
        works = normalizeFeeds(data)
        break
      } catch (error) {
        if (!(error instanceof McpRequestError) || !error.retryableSearch) throw error
        if (attempt)
          throw new Error(
            '搜索页面加载失败，已自动重试一次。请开启“显示采集浏览器”检查是否需要页面验证，完成后重新搜索',
            { cause: error }
          )
        this.integration.operation = '页面加载异常，稍后重试搜索（1/1）'
        this.changed()
        await new Promise<void>((resolve) => setTimeout(resolve, 1500))
      }
    }
    if (this.works.size + works.filter((w) => !this.works.has(w.id)).length > 2000)
      throw new Error('候选作品已达 2000 个，请清空后重新搜索')
    works.forEach((work) => this.works.set(work.id, { ...work, searchTimeRange: timeRange }))
    this.changed()
  }
  async read(work: Work, signal: AbortSignal): Promise<SourceComment[]> {
    if (!work.xsecToken) throw new Error('作品缺少访问凭证，请重新搜索作品')
    return normalizeComments(
      await this.request(
        '/api/v1/feeds/detail',
        '读取作品评论',
        {
          feed_id: work.id,
          xsec_token: work.xsecToken,
          load_all_comments: true,
          comment_config: {
            max_comment_items: 200,
            click_more_replies: false,
            scroll_speed: 'slow'
          }
        },
        signal
      ),
      work
    )
  }
  async profile(userId: string, xsecToken: string): Promise<PublicProfile> {
    return normalizeProfile(
      await this.request('/api/v1/user/profile', '读取用户主页', {
        user_id: userId,
        xsec_token: xsecToken
      })
    )
  }
  async reply(row: CommentResult, value: string): Promise<void> {
    const content = validateReplyContent(value)
    const token = replyToken(row)
    if (this.integration.loggedIn !== true) throw new Error('请先确认小红书登录状态')
    const data = object(
      await this.request(
        '/api/v1/feeds/comment/reply',
        '回复评论',
        {
          feed_id: row.workId,
          xsec_token: token,
          comment_id: row.commentId,
          // 不传 user_id，避免上游找不到评论 ID 时退回匹配同用户的其他评论。
          content
        },
        undefined,
        330_000
      )
    )
    if (
      data.success !== true ||
      data.feed_id !== row.workId ||
      data.target_comment_id !== row.commentId
    )
      throw new Error('回复结果未确认，请先到小红书核实')
  }
  async idle(): Promise<void> {
    await this.tail
  }
  cancel(): void {
    this.controllers.forEach((controller) => controller.abort())
  }
}
