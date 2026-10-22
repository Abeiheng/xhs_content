import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, CollectorAPI } from '../shared/types'
const api: CollectorAPI = {
  state: () => ipcRenderer.invoke('collector:state'),
  saveSettings: (value) => ipcRenderer.invoke('collector:settings', value),
  theme: (theme) => ipcRenderer.invoke('collector:theme', theme),
  source: (source) => ipcRenderer.invoke('collector:source', source),
  connect: () => ipcRenderer.invoke('collector:connect'),
  browserVisible: (visible) => ipcRenderer.invoke('collector:browser-visible', visible),
  selectMcpPath: () => ipcRenderer.invoke('collector:select-mcp-path'),
  loginQr: () => ipcRenderer.invoke('collector:login-qr'),
  loginStatus: () => ipcRenderer.invoke('collector:login-status'),
  search: (query) => ipcRenderer.invoke('collector:search', query),
  clearCandidates: () => ipcRenderer.invoke('collector:clear-candidates'),
  removeCandidate: (workId) => ipcRenderer.invoke('collector:remove-candidate', workId),
  exportResults: () => ipcRenderer.invoke('collector:export-results'),
  resetCollection: () => ipcRenderer.invoke('collector:reset-collection'),
  profile: (workId, commentId) => ipcRenderer.invoke('collector:profile', workId, commentId),
  importData: () => ipcRenderer.invoke('collector:import'),
  start: () => ipcRenderer.invoke('collector:start'),
  pause: () => ipcRenderer.invoke('collector:pause'),
  resume: () => ipcRenderer.invoke('collector:resume'),
  stop: () => ipcRenderer.invoke('collector:stop'),
  results: (page) => ipcRenderer.invoke('collector:results', page),
  reply: (workId, commentId, content) =>
    ipcRenderer.invoke('collector:reply', workId, commentId, content),
  pin: () => ipcRenderer.invoke('collector:pin'),
  close: () => ipcRenderer.send('collector:close'),
  openExternal: (url) => ipcRenderer.invoke('collector:external', url),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: AppState): void => callback(value)
    ipcRenderer.on('collector:state', listener)
    return () => ipcRenderer.removeListener('collector:state', listener)
  }
}
contextBridge.exposeInMainWorld('api', api)
