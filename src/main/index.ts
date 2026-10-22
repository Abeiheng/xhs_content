import { app, shell, BrowserWindow, ipcMain, dialog, powerMonitor } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Storage } from './services/storage'
import { Scheduler } from './services/scheduler'
import { McpSource } from './services/mcp-source'
import { McpService } from './services/mcp-service'
import { Replies } from './services/replies'
import { demoWorks, importWorks, readLocal } from './services/sources'
import { safeUrl, validateSettings } from '../shared/rules'
import type { AppState, FilterSettings, SourceMode, Theme, Work } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let storage: Storage
let scheduler: Scheduler
let mcp: McpSource
let service: McpService
let replies: Replies
let source: SourceMode = 'mcp'
let imported: Work[] = []
const demos = demoWorks()
function works(): Work[] {
  return source === 'demo' ? demos : source === 'import' ? imported : [...mcp.works.values()]
}
function state(): AppState {
  const candidates = [...mcp.works.values()].map((work) => ({
    id: work.id,
    title: work.title,
    publishedAt: work.publishedAt || null,
    url: work.url
  }))
  return {
    settings: storage.settings,
    task: scheduler.state,
    source,
    sourceCount: works().length,
    resultCount: storage.page(source, 1).total,
    integration: service.state,
    notice: storage.notice,
    candidates
  }
}
function broadcast(): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('collector:state', state())
}
function unlocked(): void {
  if (replies?.busy) throw new Error('请等待评论回复完成')
  if (scheduler.active) throw new Error('任务结束后可修改筛选规则和数据来源')
}
function registerIPC(): void {
  // 只有应用自身的渲染窗口能够调用白名单能力；远程登录窗口没有 preload。
  const handle = (name: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(`collector:${name}`, (event, ...args) => {
      if (
        event.sender !== mainWindow?.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      )
        throw new Error('不允许访问')
      return fn(...(args as never[]))
    })
  }
  handle('state', () => state())
  handle('settings', (value: FilterSettings) => {
    unlocked()
    const validated = validateSettings(value)
    const mcpPathChanged = validated.mcpPath !== storage.settings.mcpPath
    const rangeChanged = validated.workTimeRange !== storage.settings.workTimeRange
    if (rangeChanged && service.state.operation)
      throw new Error('请等待当前登录或搜索操作完成后再修改作品时间范围')
    if (mcpPathChanged && service.state.operation)
      throw new Error('请等待当前小红书操作完成后再修改 MCP 路径')
    try {
      storage.save({ ...validated, theme: storage.settings.theme })
    } catch {
      throw new Error('设置未保存，请重试')
    }
    if (mcpPathChanged) {
      service.setBinaryPath(validated.mcpPath || '')
      if (service.state.status !== 'stopped') service.stop()
    }
    if (rangeChanged) {
      mcp.works.clear()
      scheduler.reset()
    }
    broadcast()
    return state()
  })
  handle('theme', (theme: Theme) => {
    if (!['red', 'blue', 'green', 'purple'].includes(theme)) throw new Error('未知主题')
    try {
      storage.save({ ...storage.settings, theme })
    } catch {
      throw new Error('设置未保存，请重试')
    }
    broadcast()
    return state()
  })
  handle('source', (mode: SourceMode) => {
    unlocked()
    if (!['mcp', 'demo', 'import'].includes(mode)) throw new Error('未知来源')
    source = mode
    scheduler.reset()
    return state()
  })
  handle('connect', async () => {
    await service.start()
    return state()
  })
  handle('select-mcp-path', async () => {
    unlocked()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 MCP 可执行文件或所在目录',
      filters: process.platform === 'win32' ? [{ name: 'Windows 程序', extensions: ['exe'] }] : [],
      properties: ['openFile', 'openDirectory']
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })
  handle('browser-visible', async (visible: boolean) => {
    unlocked()
    await mcp.idle()
    await service.setBrowserVisible(visible)
    if (service.state.status === 'ready') await mcp.loginStatus()
    return state()
  })
  handle('login-qr', async () => {
    unlocked()
    return mcp.loginQr()
  })
  handle('login-status', async () => {
    unlocked()
    await mcp.loginStatus()
    return state()
  })
  handle('search', async (query: string) => {
    unlocked()
    await mcp.search(query, storage.settings.workTimeRange)
    broadcast()
    return state()
  })
  handle('clear-candidates', () => {
    unlocked()
    mcp.works.clear()
    scheduler.reset()
    broadcast()
    return state()
  })
  handle('remove-candidate', (workId: string) => {
    unlocked()
    if (!workId || !mcp.works.delete(workId)) throw new Error('候选作品不存在或已被移除')
    scheduler.reset()
    broadcast()
    return state()
  })
  handle('export-results', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出小红书评论',
      defaultPath: 'xiaohongshu-comments.csv',
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return
    const escape = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = storage.records.filter((row) => row.source === 'mcp')
    const csv = [
      ['昵称', '评论', '评论时间', '作品标题', '作品链接', '命中关键词', '采集时间'].map(escape).join(','),
      ...rows.map((row) =>
        [
          row.nickname,
          row.content,
          row.publishedAt,
          row.workTitle,
          row.workUrl,
          row.matchedCommentKeywords.join('、'),
          row.collectedAt
        ].map(escape).join(',')
      )
    ].join('\n')
    writeFileSync(result.filePath, '\ufeff' + csv, 'utf8')
  })
  handle('reset-collection', () => {
    unlocked()
    if (service.state.operation) throw new Error('请等待当前小红书操作完成后再重置采集')
    try {
      storage.clearResults()
    } catch {
      throw new Error('重置失败，已有采集数据已保留，请检查磁盘后重试')
    }
    mcp.works.clear()
    imported = []
    scheduler.reset()
    broadcast()
    return state()
  })
  handle('profile', async (workId: string, commentId: string) => {
    const row = storage.records.find(
      (r) => r.source === source && r.workId === workId && r.commentId === commentId
    )
    if (!row?.userId || !row.userXsecToken || source !== 'mcp')
      throw new Error('此记录没有可用的用户主页凭证，仍可使用公开主页链接')
    return mcp.profile(row.userId, row.userXsecToken)
  })
  handle('import', async () => {
    unlocked()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入已获取的作品与评论',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled) return state()
    unlocked()
    if (statSync(result.filePaths[0]).size > 30 * 1024 * 1024)
      throw new Error('文件超过 30 MB，请分批导入')
    imported = importWorks(JSON.parse(readFileSync(result.filePaths[0], 'utf8')))
    source = 'import'
    scheduler.reset()
    return state()
  })
  handle('start', () => {
    if (replies.busy) throw new Error('请等待评论回复完成后再开始采集')
    validateSettings(storage.settings)
    if (!works().length)
      throw new Error(
        source === 'mcp' ? '请先进入小红书接入页，扫码登录并搜索候选作品' : '请先导入作品数据'
      )
    if (source === 'mcp' && (service.state.status !== 'ready' || service.state.loggedIn !== true))
      throw new Error('请先启动采集服务并确认登录状态')
    scheduler.start(works(), storage.settings, source)
    return state()
  })
  handle('pause', () => {
    scheduler.pause()
    return state()
  })
  handle('resume', () => {
    scheduler.resume()
    return state()
  })
  handle('stop', () => {
    scheduler.stop()
    return state()
  })
  handle('results', (page: number) => storage.page(source, page))
  handle('reply', async (workId: string, commentId: string, content: string) => {
    unlocked()
    if (source !== 'mcp') throw new Error('仅支持回复真实采集的评论')
    if (service.state.status !== 'ready' || service.state.loggedIn !== true)
      throw new Error('请先启动小红书服务并确认登录状态')
    if (service.state.operation) throw new Error('请等待当前小红书操作完成后再回复')
    try {
      return await replies.send(workId, commentId, content)
    } finally {
      broadcast()
    }
  })
  handle('pin', () => {
    const pinned = !mainWindow!.isAlwaysOnTop()
    mainWindow!.setAlwaysOnTop(pinned)
    return pinned
  })
  handle('external', async (url: string) => {
    await shell.openExternal(safeUrl(url))
  })
  ipcMain.on('collector:close', (event) => {
    if (event.sender === mainWindow?.webContents) app.quit()
  })
}
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 330,
    height: 600,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F8FA',
    title: '测试软件 · 小红书采集',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => scheduler.stop())
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.xiaohongshu.collector')
  storage = new Storage(join(app.getPath('userData'), 'collector'))
  service = new McpService(join(app.getPath('userData'), 'xiaohongshu-mcp'), broadcast)
  service.setBinaryPath(storage.settings.mcpPath || '')
  mcp = new McpSource(
    () => service.origin,
    () => service.token,
    service.state,
    broadcast
  )
  replies = new Replies(storage, mcp, () => storage.settings.replyIntervalSeconds)
  scheduler = new Scheduler(
    (work, signal) => (source === 'mcp' ? mcp.read(work, signal) : readLocal(work, signal)),
    (rows) => storage.append(rows),
    broadcast
  )
  registerIPC()
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  powerMonitor.on('suspend', () => scheduler.suspend())
  createWindow()
})
app.on('before-quit', () => {
  scheduler?.stop()
  mcp?.cancel()
  service?.stop()
})
app.on('window-all-closed', () => app.quit())
