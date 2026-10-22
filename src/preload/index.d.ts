import type { CollectorAPI } from '../shared/types'
declare global {
  interface Window {
    api: CollectorAPI
  }
}
