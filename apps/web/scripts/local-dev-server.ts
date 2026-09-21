import type { ServerOptions } from 'vite';

/** The stack's backend address is server-only; browsers use the Vite origin. */
export function localDevServer(
  env: Record<string, string | undefined>
): Pick<ServerOptions, 'hmr' | 'proxy'> {
  // Browser dev follows the page's host, port and ws/wss protocol, including
  // reverse proxies. Native development can still supply its device host.
  const hmr: ServerOptions['hmr'] = env.TAURI_DEV_HOST
    ? { host: env.TAURI_DEV_HOST, protocol: 'ws' }
    : undefined;
  const target = env.MACRO_LOCAL_BACKEND_PROXY;
  if (!target) return { hmr };

  const routes = env.MACRO_LOCAL_BACKEND_ROUTES?.split(',');
  if (
    !routes?.length ||
    routes.some((route) => !/^\/[a-z0-9-]+$/.test(route))
  ) {
    throw new Error(
      'MACRO_LOCAL_BACKEND_ROUTES must list backend path prefixes'
    );
  }

  return {
    hmr,
    proxy: Object.fromEntries(
      routes.map((route) => [
        // Include bare WebSocket paths, but not /authentic or /sync-other.
        `^${route}(?:/|\\?|$)`,
        { target, ws: true, xfwd: true },
      ])
    ),
  };
}
