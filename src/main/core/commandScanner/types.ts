import type { ApplicationIdentity } from '@shared/applicationIdentity'

export interface Command extends ApplicationIdentity {
  name: string
  path: string
  icon?: string
  aliases?: string[]
  targetPath?: string
  launchSignature?: string
  searchSource?: 'files' | 'systemSettings'
  acronym?: string // 英文首字母缩写（用于搜索）
}

export interface ApplicationScanResult {
  apps: Command[]
  complete: boolean
  errors: string[]
}

export interface AppScanner {
  scanApplications(): Promise<ApplicationScanResult>
}
