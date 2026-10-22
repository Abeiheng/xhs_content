export type Theme = 'red' | 'blue' | 'green' | 'purple'
export type SourceMode = 'mcp' | 'demo' | 'import'
export type WorkTimeRange = '不限' | '一天内' | '一周内' | '半年内'
export interface CommentKeywordGroup {
  name: string
  include: string[]
  exclude: string[]
}
export interface FilterSettings {
  workTimeRange: WorkTimeRange
  workKeywords?: string[]
  commentKeywords: string[]
  intervalMinutes: number
  worksPerKeyword: number
  commentGroups?: CommentKeywordGroup[]
  activeCommentGroup?: number
  replyIntervalSeconds: number
  /** 用户指定的本地 MCP 可执行文件或所在目录；空值使用内置组件。 */
  mcpPath?: string
}
export interface Settings extends FilterSettings {
  theme: Theme
}
export interface IntegrationState {
  visibleBrowser: boolean
  managed: boolean
  status: 'stopped' | 'installing' | 'starting' | 'ready' | 'error'
  message: string
  loggedIn: boolean | null
  username: string | null
  operation: string | null
}
export interface LoginQr {
  image: string | null
  expiresAt: string | null
  loggedIn: boolean
}
export interface PublicProfile {
  nickname: string | null
  redId: string | null
  description: string | null
  location: string | null
  interactions: { name: string; count: string }[]
  works: { id: string; title: string; url: string | null }[]
}
export interface SourceComment {
  userId?: string | null
  userXsecToken?: string | null
  id: string
  content: string
  nickname: string | null
  userProfileUrl: string | null
  publishedAt: string | null
}
export interface Work {
  publishedAt?: string | null
  searchTimeRange?: WorkTimeRange
  xsecToken?: string
  collectionScope?: string
  id: string
  title: string
  description: string
  url: string | null
  comments?: SourceComment[]
}
export interface SelectedWork extends Work {
  matchedKeywords: string[]
}
export interface CommentResult {
  workXsecToken?: string
  reply?: ReplyRecord
  userId?: string | null
  userXsecToken?: string | null
  collectionScope?: string
  workId: string
  commentId: string
  nickname: string | null
  userProfileUrl: string | null
  workTitle: string | null
  workUrl: string | null
  content: string
  matchedWorkKeywords: string[]
  matchedCommentKeywords: string[]
  publishedAt: string | null
  collectedAt: string
  source: SourceMode
}
export interface ReplyRecord {
  workId: string
  commentId: string
  content: string
  status: 'sending' | 'sent' | 'unknown'
  updatedAt: string
  message: string
}
export type TaskPhase = 'idle' | 'reading' | 'waiting' | 'paused' | 'completed' | 'attention'
export interface TaskState {
  phase: TaskPhase
  total: number
  completed: number
  currentTitle: string
  currentKeywords: string[]
  remainingSeconds: number
  message: string
  groups: { keyword: string; selected: number; completed: number }[]
}
export interface AppState {
  settings: Settings
  task: TaskState
  source: SourceMode
  sourceCount: number
  resultCount: number
  integration: IntegrationState
  notice: string
  candidates: CandidateWork[]
}
export interface CandidateWork {
  id: string
  title: string
  publishedAt: string | null
  url: string | null
}
export interface SaveResult {
  added: number
  skipped: number
}
export interface ResultPage {
  rows: CommentResult[]
  total: number
}
export interface CollectorAPI {
  state(): Promise<AppState>
  saveSettings(settings: FilterSettings): Promise<AppState>
  theme(theme: Theme): Promise<AppState>
  source(mode: SourceMode): Promise<AppState>
  connect(): Promise<AppState>
  browserVisible(visible: boolean): Promise<AppState>
  selectMcpPath(): Promise<string | null>
  loginQr(): Promise<LoginQr>
  loginStatus(): Promise<AppState>
  search(query: string): Promise<AppState>
  clearCandidates(): Promise<AppState>
  removeCandidate(workId: string): Promise<AppState>
  exportResults(): Promise<void>
  resetCollection(): Promise<AppState>
  profile(workId: string, commentId: string): Promise<PublicProfile>
  importData(): Promise<AppState>
  start(): Promise<AppState>
  pause(): Promise<AppState>
  resume(): Promise<AppState>
  stop(): Promise<AppState>
  results(page: number): Promise<ResultPage>
  reply(workId: string, commentId: string, content: string): Promise<ReplyRecord>
  pin(): Promise<boolean>
  close(): void
  openExternal(url: string): Promise<void>
  subscribe(callback: (state: AppState) => void): () => void
}
