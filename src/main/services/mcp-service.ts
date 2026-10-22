import { app, net } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import manifest from '../../../resources/xiaohongshu-mcp/manifest.json'
import searchFix from '../../../resources/xiaohongshu-mcp/search-fix.json'
import type { IntegrationState } from '../../shared/types'
import { object } from './mcp-source'

type Asset = { asset: string; sha256: string; id: number }
export class McpService {
  state: IntegrationState = {
    visibleBrowser: false,
    managed: !process.env.XHS_MCP_URL,
    status: 'stopped',
    message: '尚未启动采集服务',
    loggedIn: null,
    username: null,
    operation: null
  }
  origin = ''
  token = ''
  private child?: ChildProcess
  private startup?: Promise<void>
  private controller?: AbortController
  private stopped = false
  private binaryPath = ''
  constructor(
    private directory: string,
    private changed: () => void
  ) {
    try {
      this.state.visibleBrowser =
        JSON.parse(readFileSync(join(directory, 'browser-options.json'), 'utf8')).visibleBrowser ===
        true
    } catch {
      /* 默认无头运行。 */
    }
  }
  setBinaryPath(path: string): void {
    this.binaryPath = path.trim()
  }
  async setBrowserVisible(visible: boolean): Promise<void> {
    if (!this.state.managed) throw new Error('外部服务的浏览器模式请在其启动参数中设置')
    if (typeof visible !== 'boolean') throw new Error('浏览器模式参数无效')
    if (this.startup) throw new Error('请等待服务启动完成后再切换浏览器模式')
    if (visible === this.state.visibleBrowser) return
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = join(this.directory, 'browser-options.json')
    writeFileSync(path + '.tmp', JSON.stringify({ visibleBrowser: visible }))
    renameSync(path + '.tmp', path)
    this.state.visibleBrowser = visible
    const restart = this.state.status === 'ready'
    const child = this.child
    if (restart) {
      this.stop()
      if (child && child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 6000)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
      await this.start()
    }
    this.changed()
  }
  start(): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve()
    if (this.startup) return this.startup
    this.stopped = false
    const promise = this.launch()
      .catch((error) => {
        this.child?.kill()
        this.child = undefined
        if (!this.stopped) {
          this.state.status = 'error'
          this.state.message = error instanceof Error ? error.message : '服务启动失败'
          this.changed()
        }
        throw error
      })
      .finally(() => {
        this.startup = undefined
      })
    this.startup = promise
    return promise
  }
  private async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(`${this.origin}/health`, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(1500)])
          : AbortSignal.timeout(1500)
      })
      const raw = object(await response.json()),
        data = object(raw.data)
      return response.ok && raw.success === true && data.service === 'xiaohongshu-mcp'
    } catch {
      return false
    }
  }
  private async launch(): Promise<void> {
    this.state.status = 'starting'
    this.state.message = '正在启动采集服务'
    this.changed()
    this.controller = new AbortController()
    const signal = this.controller.signal
    const external = process.env.XHS_MCP_URL
    if (external) {
      const url = new URL(external)
      if (
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error('XHS_MCP_URL 必须是本机 http 服务地址')
      this.origin = url.origin
      this.token = process.env.XHS_MCP_TOKEN || ''
      if (!(await this.health(signal)))
        throw new Error('未能连接本机 xiaohongshu-mcp，请检查服务是否启动')
      this.state.status = 'ready'
      this.state.message = '已连接本机采集服务'
      this.changed()
      return
    }
    const key = `${process.platform}-${process.arch}`
    const asset = (manifest.platforms as Record<string, Asset>)[key]
    if (!asset)
      throw new Error(
        '当前平台暂无上游预编译工具；支持 Apple Silicon macOS、Windows x64、Linux x64'
      )
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const bundled = join(
      app.isPackaged
        ? join(process.resourcesPath, 'mcp', 'bin')
        : join(app.getAppPath(), '.mcp-bin'),
      key,
      asset.asset
    )
    const customPath = this.binaryPath
      ? (() => {
          if (!existsSync(this.binaryPath))
            throw new Error(`自定义 MCP 路径不存在：${this.binaryPath}`)
          const info = statSync(this.binaryPath)
          return info.isDirectory() ? join(this.binaryPath, asset.asset) : this.binaryPath
        })()
      : ''
    if (customPath && !existsSync(customPath))
      throw new Error(`自定义 MCP 文件不存在：${customPath}`)
    const installed = join(this.directory, manifest.version, asset.asset)
    let binary = customPath || bundled
    const verified = (path: string): boolean =>
      existsSync(path) &&
      createHash('sha256').update(readFileSync(path)).digest('hex') === asset.sha256
    const patched = (searchFix.platforms as Record<string, { asset: string; sha256: string }>)[key]
    const patchedPath = !customPath && patched ? join(bundled, '..', patched.asset) : ''
    const patchedValid =
      patched &&
      existsSync(patchedPath) &&
      createHash('sha256').update(readFileSync(patchedPath)).digest('hex') === patched.sha256
    if (patchedValid) binary = patchedPath
    else if (!customPath && !verified(bundled)) {
      binary = installed
      if (!verified(installed)) {
        this.state.status = 'installing'
        this.state.message = '正在下载采集组件（首次使用）'
        this.changed()
        const response = await net.fetch(
          `https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases/assets/${asset.id}?download=1`,
          {
            headers: { Accept: 'application/octet-stream' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)])
          }
        )
        if (!response.ok)
          throw new Error(`采集组件下载失败 HTTP ${response.status}，可运行 pnpm setup:mcp 后重试`)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
          throw new Error('采集组件校验失败，请重新下载')
        mkdirSync(join(this.directory, manifest.version), { recursive: true, mode: 0o700 })
        writeFileSync(installed + '.tmp', bytes, { mode: 0o700 })
        chmodSync(installed + '.tmp', 0o700)
        renameSync(installed + '.tmp', installed)
      }
    }
    if (signal.aborted) throw new Error('启动已取消')
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const value = typeof address === 'object' && address ? address.port : 0
        server.close(() => resolve(value))
      })
    })
    this.origin = `http://127.0.0.1:${port}`
    this.token = randomBytes(32).toString('hex')
    this.state.status = 'starting'
    this.state.message = '正在准备浏览器，首次下载约 140–190 MB'
    this.changed()
    const child = spawn(
      binary,
      ['-port', `127.0.0.1:${port}`, `-headless=${!this.state.visibleBrowser}`],
      {
        cwd: this.directory,
        env: {
          ...process.env,
          AUTH_TOKEN: this.token,
          COOKIES_PATH: join(this.directory, 'cookies.json')
        },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      }
    )
    this.child = child
    let launchError: Error | undefined
    let lastOutput = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      lastOutput = (lastOutput + chunk.toString('utf8')).slice(-1500)
    })
    child.once('error', (error) => {
      launchError = error
    })
    child.once('exit', () => {
      if (this.child !== child) return
      this.child = undefined
      if (this.state.status === 'ready') {
        this.state.status = 'error'
        this.state.loggedIn = null
        this.state.message = '采集服务已退出，请重新启动'
        this.changed()
      }
    })
    const started = Date.now()
    while (Date.now() - started < 600_000) {
      if (signal.aborted) throw new Error('启动已取消')
      if (launchError) throw new Error(`无法启动采集组件：${launchError.message}`)
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `采集服务启动失败${lastOutput.includes('下载') ? '：浏览器下载失败，请检查网络后重试' : '，请检查运行环境后重试'}`
        )
      if (await this.health(signal)) {
        this.state.status = 'ready'
        this.state.message = patchedValid ? '采集服务已就绪（搜索兼容修复）' : '采集服务已就绪'
        this.changed()
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('浏览器准备超时，请检查网络后重试')
  }
  stop(): void {
    this.stopped = true
    this.controller?.abort()
    const child = this.child
    this.child = undefined
    child?.kill()
    if (child) {
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 5000)
      force.unref()
    }
    this.state.status = 'stopped'
    this.state.loggedIn = null
    this.state.username = null
    this.state.operation = null
    this.state.message = '采集服务已停止'
  }
}
