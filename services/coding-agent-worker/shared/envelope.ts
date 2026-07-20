import { z } from 'zod'

export const Method = {
  Status: 'system/status',
  Acp: 'acp',
} as const

export const SystemStatus = z.enum(['booting', 'ready', 'shutting_down'])
export type SystemStatus = z.infer<typeof SystemStatus>

export const StatusParams = z.object({ status: SystemStatus })
export type StatusParams = z.infer<typeof StatusParams>
