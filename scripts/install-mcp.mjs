import { readFile, mkdir, writeFile, chmod, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(
  await readFile(join(root, 'resources/xiaohongshu-mcp/manifest.json'), 'utf8')
)
const platform = process.argv[2] || `${process.platform}-${process.arch}`
const asset = manifest.platforms[platform]
if (!asset)
  throw new Error(`上游暂不支持 ${platform}，支持 ${Object.keys(manifest.platforms).join('、')}`)
const directory = join(root, '.mcp-bin', platform)
await mkdir(directory, { recursive: true })
const path = join(directory, asset.asset)
try {
  const existing = await readFile(path)
  if (createHash('sha256').update(existing).digest('hex') === asset.sha256) {
    console.log(`已安装并校验：${path}`)
    process.exit(0)
  }
} catch {
  /* 安装尚不存在。 */
}
const url = `https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases/assets/${asset.id}?download=1`
console.log(`下载 ${manifest.version}：${url}`)
let bytes
try {
  await promisify(execFile)(
    'curl',
    [
      '--fail',
      '--location',
      '--retry',
      '2',
      '--connect-timeout',
      '10',
      '--max-time',
      '180',
      '--header',
      'Accept: application/octet-stream',
      '--output',
      path + '.tmp',
      url
    ],
    { timeout: 240_000 }
  )
  bytes = await readFile(path + '.tmp')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  const response = await fetch(url, {
    headers: { Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(180_000)
  })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`, { cause: error })
  bytes = Buffer.from(await response.arrayBuffer())
}
if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
  throw new Error('SHA256 校验失败，未安装该文件')
await writeFile(path + '.tmp', bytes)
await chmod(path + '.tmp', 0o755)
await rename(path + '.tmp', path)
console.log(`已安装并校验：${path}`)
