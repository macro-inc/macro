/**
 * Worker stand-in for `@observability/logger`, aliased in at build time (see
 * tsconfig `paths` + wrangler `alias`). The real module pulls in
 * `@datadog/browser-logs`, a browser-only lib that has no place in a Cloudflare
 * Worker. The sync engine only needs `logger.{log,warn,error}`, so this maps
 * them straight to `console`.
 */
type Context = Record<string, unknown> | undefined;

export function log(message: string, context?: Context) {
	console.log(message, context ?? "");
}

export function warn(message: string, context?: Context) {
	console.warn(message, context ?? "");
}

export function error(message: unknown, context?: Context) {
	console.error(message, context ?? "");
}

export const logger = { log, warn, error };
