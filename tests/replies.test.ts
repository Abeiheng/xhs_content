import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Storage } from '../src/main/services/storage'
import { Replies } from '../src/main/services/replies'
import { McpSource } from '../src/main/services/mcp-source'
import { replyToken } from '../src/shared/rules'
import type { CommentResult, IntegrationState } from '../src/shared/types'
const directories: string[] = []
const row: CommentResult = {
  workId: 'note-1',
  commentId: 'comment-1',
  source: 'mcp',
  userId: 'user-1',
  userXsecToken: 'user-token',
  nickname: '示例用户',
  content: '请问价格？',
  workTitle: '示例作品',
  workUrl: 'https://www.xiaohongshu.com/explore/note-1?xsec_token=work-token',
  userProfileUrl: null,
  publishedAt: null,
  collectedAt: '2026-10-22T04:00:00Z',
  matchedWorkKeywords: ['作品'],
  matchedCommentKeywords: ['价格']
}
function storage(): Storage {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-replies-'))
  directories.push(dir)
  const store = new Storage(dir)
  store.append([row])
  return store
}
afterEach(() => {
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})
describe('评论回复', () => {
  it('使用作品凭证和精确评论ID，响应校验匹配目标；不传user_id兜底', async () => {
    const state: IntegrationState = {
      status: 'ready',
      loggedIn: true,
      visibleBrowser: false,
      managed: true,
      message: '',
      username: null,
      operation: null
    }
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { success: true, feed_id: 'note-1', target_comment_id: 'comment-1' }
        })
      )
    )
    const mcp = new McpSource(
      () => 'http://127.0.0.1:12345',
      () => 'test-token',
      state,
      () => {},
      fetcher
    )
    await mcp.reply(row, '  谢谢关注  ')
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:12345/api/v1/feeds/comment/reply')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      feed_id: 'note-1',
      comment_id: 'comment-1',
      xsec_token: 'work-token',
      content: '谢谢关注'
    })
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { success: true, feed_id: 'other', target_comment_id: 'comment-1' }
        })
      )
    )
    await expect(mcp.reply(row, '你好')).rejects.toThrow('未确认')
  })
  it('不自动重试回复；拒绝空内容、超长、假数据和错作品链接', async () => {
    const state: IntegrationState = {
      status: 'ready',
      loggedIn: true,
      visibleBrowser: false,
      managed: true,
      message: '',
      username: null,
      operation: null
    }
    const fetcher = vi.fn().mockRejectedValue(new TypeError('connection reset'))
    const mcp = new McpSource(
      () => 'http://127.0.0.1:12345',
      () => '',
      state,
      () => {},
      fetcher
    )
    await expect(mcp.reply(row, '你好')).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (const content of ['', '   ', '字'.repeat(501)])
      await expect(mcp.reply(row, content)).rejects.toThrow()
    expect(() => replyToken({ ...row, source: 'demo' })).toThrow('真实')
    expect(() =>
      replyToken({ ...row, workUrl: 'https://www.xiaohongshu.com/explore/other?xsec_token=wrong' })
    ).toThrow('凭证')
    expect(() => replyToken({ ...row, workUrl: null })).toThrow('凭证')
    state.loggedIn = false
    await expect(mcp.reply(row, '你好')).rejects.toThrow('登录')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('在途防重入、成功落盘、重启后禁止重复回复', async () => {
    const store = storage()
    let resolve!: () => void
    const reply = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        })
    )
    const service = new Replies(store, { reply })
    const sending = service.send(row.workId, row.commentId, '你好')
    expect(store.replyRecord(row.workId, row.commentId)?.status).toBe('sending')
    await expect(service.send(row.workId, row.commentId, '你好')).rejects.toThrow('重复')
    resolve()
    expect((await sending).status).toBe('sent')
    const restored = new Storage(directories[0])
    expect(restored.page('mcp', 1).rows[0].reply?.content).toBe('你好')
    await expect(
      new Replies(restored, { reply }).send(row.workId, row.commentId, '再发一次')
    ).rejects.toThrow('已经回复')
    expect(reply).toHaveBeenCalledTimes(1)
  })
  it('中断/异常保留待确认；只有用户再次显式发送才会再调接口', async () => {
    const store = storage()
    store.saveReply({
      workId: row.workId,
      commentId: row.commentId,
      content: '之前的内容',
      status: 'sending',
      updatedAt: new Date().toISOString(),
      message: ''
    })
    const restored = new Storage(directories[0])
    expect(restored.replyRecord(row.workId, row.commentId)?.status).toBe('unknown')
    const reply = vi.fn().mockRejectedValue(new Error('timeout'))
    const service = new Replies(restored, { reply })
    const result = await service.send(row.workId, row.commentId, '再次确认发送的内容')
    expect(result.status).toBe('unknown')
    expect(result.content).toBe('再次确认发送的内容')
    expect(reply).toHaveBeenCalledTimes(1)
    expect(new Storage(directories[0]).replyRecord(row.workId, row.commentId)?.status).toBe(
      'unknown'
    )
  })
  it('预写记录失败不调用平台；发送后落盘失败也保留已发送状态', async () => {
    const store = storage()
    const reply = vi.fn().mockResolvedValue(undefined)
    const save = vi.spyOn(store, 'saveReply').mockImplementationOnce(() => {
      throw new Error('disk')
    })
    const service = new Replies(store, { reply })
    await expect(service.send(row.workId, row.commentId, '你好')).rejects.toThrow('disk')
    expect(reply).not.toHaveBeenCalled()
    expect(service.busy).toBe(false)
    save.mockRestore()
    const original = store.saveReply.bind(store)
    vi.spyOn(store, 'saveReply')
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => {
        throw new Error('disk')
      })
    expect((await service.send(row.workId, row.commentId, '你好')).status).toBe('sent')
    expect(store.replyRecord(row.workId, row.commentId)?.status).toBe('sent')
  })
  it('损坏的历史回复记录阻止盲目重复发送', async () => {
    const store = storage()
    writeFileSync(join(directories[0], 'replies.json'), '{bad')
    const reply = vi.fn()
    await expect(
      new Replies(new Storage(directories[0]), { reply }).send(row.workId, row.commentId, '你好')
    ).rejects.toThrow('记录损坏')
    expect(reply).not.toHaveBeenCalled()
    expect(store.records).toHaveLength(1)
  })
})
