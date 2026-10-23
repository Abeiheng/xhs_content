import type {
  CommentResult,
  FilterSettings,
  SelectedWork,
  Settings,
  Work,
  WorkTimeRange
} from './types'
export const workTimeRanges: WorkTimeRange[] = ['不限', '一天内', '一周内', '半年内']
export const maxWorksPerKeyword = 2000
export const maxIntervalSeconds = 86_400
export const defaults: Settings = {
  workTimeRange: '不限',
  workKeywords: [],
  commentKeywords: [],
  commentGroups: [],
  activeCommentGroup: 0,
  replyIntervalSeconds: 10,
  intervalSeconds: 60,
  worksPerKeyword: 10,
  theme: 'red'
}
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>()
  return input
    .replaceAll('，', ',')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => {
      if (!s || seen.has(s.toLowerCase())) return false
      seen.add(s.toLowerCase())
      return true
    })
}
export function includes(text: string, word: string): boolean {
  return text.toLowerCase().includes(word.toLowerCase())
}
export function validateWorksPerKeyword(value: unknown): number {
  if (value === undefined) return defaults.worksPerKeyword
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxWorksPerKeyword
  )
    throw new Error(`每个关键词作品数量请输入 1–${maxWorksPerKeyword} 的整数`)
  return value
}
export function validateSettings(value: FilterSettings): FilterSettings {
  if (!value) throw new Error('设置格式无效')
  const legacyMinutes = (value as FilterSettings & { intervalMinutes?: unknown }).intervalMinutes
  const intervalSeconds =
    value.intervalSeconds ??
    (typeof legacyMinutes === 'number' && Number.isInteger(legacyMinutes)
      ? legacyMinutes * 60
      : undefined)
  if (
    !value ||
    (value.workKeywords !== undefined && !Array.isArray(value.workKeywords)) ||
    !Array.isArray(value.commentKeywords) ||
    (value.workKeywords !== undefined && !value.workKeywords.every((s) => typeof s === 'string')) ||
    !value.commentKeywords.every((s) => typeof s === 'string')
  )
    throw new Error('关键词格式无效')
  const workKeywords = parseKeywords((value.workKeywords || []).join(','))
  const commentKeywords = parseKeywords(value.commentKeywords.join(','))
  const groups = (value.commentGroups || []).map((group, index) => ({
    name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : `组合 ${index + 1}`,
    include: parseKeywords((group.include || []).join(',')),
    exclude: parseKeywords((group.exclude || []).join(','))
  }))
  const normalizedGroups = groups.length ? groups : [{ name: '默认组合', include: commentKeywords, exclude: [] }]
  const activeCommentGroup = Math.min(Math.max(0, value.activeCommentGroup || 0), normalizedGroups.length - 1)
  const active = normalizedGroups[activeCommentGroup]
  if (!active.include.length) throw new Error('组合至少填写一个评论关键词')
  if (!commentKeywords.length) throw new Error('请填写评论关键词')
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > maxIntervalSeconds
  )
    throw new Error(`作品间隔请输入 1–${maxIntervalSeconds} 秒的整数`)
  if (workKeywords.length > 100 || commentKeywords.length > 100) throw new Error('关键词最多 100 个')
  const replyIntervalSeconds = value.replyIntervalSeconds ?? defaults.replyIntervalSeconds
  if (
    !Number.isInteger(replyIntervalSeconds) ||
    replyIntervalSeconds < 0 ||
    replyIntervalSeconds > 3600
  )
    throw new Error('回复间隔请输入 0–3600 秒的整数')
  const workTimeRange = value.workTimeRange === undefined ? '不限' : value.workTimeRange
  if (!workTimeRanges.includes(workTimeRange)) throw new Error('请选择有效的作品发布时间范围')
  return {
    workTimeRange,
    workKeywords,
    commentKeywords,
    commentGroups: normalizedGroups,
    activeCommentGroup,
    replyIntervalSeconds,
    intervalSeconds,
    worksPerKeyword: validateWorksPerKeyword(value.worksPerKeyword),
    mcpPath: typeof value.mcpPath === 'string' ? value.mcpPath.trim() : ''
  }
}
export function selectWorks(
  works: Work[],
  keywords: string[],
  timeRange: WorkTimeRange = '不限',
  now = Date.now(),
  worksPerKeyword = defaults.worksPerKeyword
): SelectedWork[] {
  const limit = validateWorksPerKeyword(worksPerKeyword)
  if (works.some((w) => !w.id)) throw new Error('作品缺少稳定 ID，请检查数据来源')
  const cutoff = new Date(now)
  if (timeRange === '半年内') cutoff.setMonth(cutoff.getMonth() - 6)
  else if (timeRange !== '不限') cutoff.setTime(now - (timeRange === '一天内' ? 1 : 7) * 86_400_000)
  const eligible =
    timeRange === '不限'
      ? works
      : works.filter((work) => {
          if (work.searchTimeRange === timeRange) return true
          const time = work.publishedAt ? Date.parse(work.publishedAt) : NaN
          return time <= now && time >= cutoff.getTime()
        })
  if (!keywords.length) return eligible.slice(0, limit).map((work) => ({ ...work, matchedKeywords: [] }))

  // The quantity is the total number of candidate works to collect. Walk the
  // candidates in their existing order, retaining every keyword matched by a
  // selected work, and stop once the global limit is reached.
  const seen = new Set<string>()
  return eligible
    .map((work) => ({
      work,
      matchedKeywords: keywords.filter(
        (keyword) => includes(work.title, keyword) || includes(work.description, keyword)
      )
    }))
    .filter(({ work, matchedKeywords }) => {
      if (!matchedKeywords.length || seen.has(work.id)) return false
      seen.add(work.id)
      return true
    })
    .slice(0, limit)
    .map(({ work, matchedKeywords }) => ({ ...work, matchedKeywords }))
}
export function safeUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('仅支持有效的 http/https 链接')
  return url.href
}
export function validateReplyContent(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写回复内容')
  const content = value.trim()
  if (content.length > 500) throw new Error('回复内容最多 500 字')
  return content
}
export function replyToken(row: CommentResult): string {
  if (row.source !== 'mcp' || !row.workId || !row.commentId)
    throw new Error('仅支持回复真实采集的评论')
  if (row.workXsecToken) return row.workXsecToken
  // 兼容已采集的历史结果：作品签名只从该作品的官方链接读取，不使用用户主页签名。
  try {
    const url = new URL(row.workUrl || '')
    if (
      url.protocol === 'https:' &&
      url.hostname === 'www.xiaohongshu.com' &&
      !url.username &&
      !url.password &&
      url.pathname === `/explore/${encodeURIComponent(row.workId)}`
    ) {
      const token = url.searchParams.get('xsec_token')
      if (token) return token
    }
  } catch {
    /* 历史记录可能没有可用链接。 */
  }
  throw new Error('此评论缺少作品访问凭证，请重新采集后回复')
}
