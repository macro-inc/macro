import { env } from './env'

const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
type Level = (typeof LEVELS)[number]

const threshold = LEVELS.indexOf(env.LOG_LEVEL as Level)

function emit(level: Exclude<Level, 'silent'>, args: unknown[]): void {
  if (LEVELS.indexOf(level) < threshold) return
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  write(`[${level}]`, ...args)
}

/** Level-gated logger; set `LOG_LEVEL=debug` to see every ACP frame crossing
 * the upstream link and the agent stream. */
export const log = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
}
