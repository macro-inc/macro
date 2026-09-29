/** Fixed upstreams for the standalone Vite development proxy. */
export const DEVELOPMENT_PROXY_TARGETS = {
  gateway: 'https://dev-gateway.macro.com',
  websocket: 'https://services-dev.macro.com',
  static: 'https://static-file-service-dev.macro.com',
  pdf: 'https://pdf-service-dev.macro.com',
  sync: 'https://sync-service-dev3.macroverse.workers.dev',
  editing: 'https://ai-editing-worker-dev.macroverse.workers.dev',
} as const;

export const DEVELOPMENT_PROXY_PREFIX = '/__macro_dev';

/** Keep hosted development APIs on the page origin, including workers and WS. */
export function developmentProxyUrl(url: string): string {
  if (
    (import.meta.env.VITE_DEV_PROXY !== true &&
      import.meta.env.VITE_DEV_PROXY !== 'true') ||
    !globalThis.location?.origin
  )
    return url;
  const parsed = new URL(url);
  const httpOrigin = parsed.origin.replace(/^ws/, 'http');
  const target = Object.entries(DEVELOPMENT_PROXY_TARGETS).find(
    ([, origin]) => origin === httpOrigin
  );
  if (!target) return url;
  const pageOrigin = parsed.protocol.startsWith('ws')
    ? globalThis.location.origin.replace(/^http/, 'ws')
    : globalThis.location.origin;
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${pageOrigin}${DEVELOPMENT_PROXY_PREFIX}/${target[0]}${path}${parsed.search}${parsed.hash}`;
}
