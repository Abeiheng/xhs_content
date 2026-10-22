// 构建带窄范围搜索就绪补丁的上游组件；需要 Go >= 1.24、curl、tar、patch。
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const resource = join(root, 'resources/xiaohongshu-mcp')
const fixPath = join(resource, 'search-fix.json')
const fix = JSON.parse(await readFile(fixPath, 'utf8'))
const manifest = JSON.parse(await readFile(join(resource, 'manifest.json'), 'utf8'))
const platform = process.argv[2] || `${process.platform}-${process.arch}`
const targets = {
  'darwin-arm64': ['darwin', 'arm64'],
  'win32-x64': ['windows', 'amd64'],
  'linux-x64': ['linux', 'amd64']
}
if (!targets[platform]) throw new Error(`不支持构建 ${platform}`)
const temp = await mkdtemp(join(tmpdir(), 'xhs-mcp-build-'))
try {
  const archive = join(temp, 'source.tar.gz')
  console.log(`下载并校验上游 ${manifest.version} 源码`)
  if (process.env.XHS_MCP_SOURCE_ARCHIVE)
    await copyFile(process.env.XHS_MCP_SOURCE_ARCHIVE, archive)
  else
    await run(
      'curl',
      [
        '-fL',
        '--retry',
        '2',
        '--connect-timeout',
        '10',
        '--max-time',
        '240',
        '-o',
        archive,
        `https://codeload.github.com/xpzouying/xiaohongshu-mcp/tar.gz/refs/tags/${manifest.version}`
      ],
      { timeout: 300_000 }
    )
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== fix.sourceSha256
  )
    throw new Error('上游源码校验失败，未应用补丁')
  const source = join(temp, 'source')
  await mkdir(source)
  await run('tar', ['-xzf', archive, '-C', source, '--strip-components=1'])
  await run('patch', ['-p1', '-i', join(resource, 'search-readiness.patch')], { cwd: source })
  const directory = join(root, '.mcp-bin', platform)
  await mkdir(directory, { recursive: true })
  const asset =
    manifest.platforms[platform].asset.replace(/\.exe$/, '') +
    '-search-fix' +
    (platform.startsWith('win32') ? '.exe' : '')
  const output = join(directory, asset)
  console.log(`编译 ${platform}（首次需要下载 Go 模块）`)
  await run(
    process.env.XHS_GO_BINARY || 'go',
    ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', output, '.'],
    {
      cwd: source,
      env: {
        ...process.env,
        GOOS: targets[platform][0],
        GOARCH: targets[platform][1],
        CGO_ENABLED: '0'
      },
      timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024
    }
  )
  fix.platforms[platform] = {
    asset,
    sha256: createHash('sha256')
      .update(await readFile(output))
      .digest('hex')
  }
  await writeFile(fixPath, JSON.stringify(fix, null, 2) + '\n')
  console.log(`补丁组件已构建并记录校验值：${output}。请重新构建并重启应用。`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
