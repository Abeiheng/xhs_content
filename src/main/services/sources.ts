import type { SourceComment, Work } from '../../shared/types'
export function demoWorks(): Work[] {
  const comments = [
    '想了解一下装修报价',
    '这个方案多少钱？',
    '小户型求推荐',
    '报价包含哪些项目？',
    '这套装修多少钱',
    '求推荐类似的风格',
    '好看，收藏了'
  ]
  return Array.from({ length: 17 }, (_, index) => ({
    id: `demo-work-${index + 1}`,
    title: index < 10 ? `装修灵感 · 第 ${index + 1} 个家` : `报价清单 · 第 ${index + 1} 个家`,
    description: index >= 7 ? '装修预算与报价，记录理想家的每个细节' : '分享小户型装修的实用灵感',
    url: null,
    publishedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    comments: comments.map((content, j) => ({
      id: `demo-comment-${index}-${j}`,
      content,
      nickname: `示例用户${String(j + 1).padStart(2, '0')}`,
      userProfileUrl: null,
      publishedAt: new Date(Date.now() - (index * 24 + j) * 3_600_000).toISOString()
    }))
  }))
}
export function importWorks(value: unknown): Work[] {
  const rows = Array.isArray(value) ? value : (value as { works?: unknown })?.works
  if (!Array.isArray(rows) || rows.length > 10000)
    throw new Error('请选择包含 works 数组的 JSON 文件，最多 10000 个作品')
  const ids = new Set<string>()
  return rows.map((row, index) => {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id.trim() ||
      typeof row.title !== 'string' ||
      !Array.isArray(row.comments)
    )
      throw new Error(`第 ${index + 1} 个作品缺少 id、title 或 comments`)
    if (ids.has(row.id)) throw new Error(`作品 ID 重复：${row.id}`)
    ids.add(row.id)
    const nullable = (value: unknown): string | null =>
      typeof value === 'string' && value ? value : null
    const comments: SourceComment[] = row.comments.map((comment: Record<string, unknown>) => {
      if (
        !comment ||
        typeof comment.id !== 'string' ||
        !comment.id.trim() ||
        typeof comment.content !== 'string'
      )
        throw new Error(`作品 ${row.id} 的评论缺少 id 或 content`)
      return {
        id: comment.id,
        content: comment.content,
        nickname: nullable(comment.nickname),
        userProfileUrl: nullable(comment.userProfileUrl),
        publishedAt: nullable(comment.publishedAt)
      }
    })
    return {
      id: row.id,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : '',
      url: nullable(row.url),
      publishedAt: nullable(row.publishedAt),
      comments
    }
  })
}
export async function readLocal(work: Work, signal: AbortSignal): Promise<SourceComment[]> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, 500)
    const cancel = (): void => {
      clearTimeout(timer)
      reject(new Error('任务已取消'))
    }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
  })
  return work.comments ?? []
}
