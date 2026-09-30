import type { ServerOptions } from 'vite';

/** The stack's backend address is server-only; browsers use the Vite origin. */
export function localDevServer(
  env: Record<string, string | undefined>
): Pick<ServerOptions, 'host' | 'hmr' | 'proxy' | 'allowedHosts'> {
  // Browser dev follows the page's host, port and ws/wss protocol, including
  // reverse proxies. Native development can still supply its device host.
  const hmr: ServerOptions['hmr'] = env.TAURI_DEV_HOST
    ? { host: env.TAURI_DEV_HOST, protocol: 'ws' }
    : undefined;
  const publicHostname = parsePublicHostname(env.LOCAL_PUBLIC_ORIGIN);
  const target = env.MACRO_LOCAL_BACKEND_PROXY;
  if (publicHostname && !target) {
    throw new Error(
      'MACRO_LOCAL_BACKEND_PROXY is required with LOCAL_PUBLIC_ORIGIN'
    );
  }
  if (publicHostname && target) validatePublicProxyTarget(target);
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

  const allowedHosts = [
    env.MACRO_LOCAL_HOSTNAME?.toLowerCase(),
    publicHostname,
  ].filter((host, index, hosts): host is string => {
    return !!host && hosts.indexOf(host) === index;
  });

  return {
    // A trusted HTTPS proxy such as Tailscale Serve can own the same port on
    // the machine's network interface while reaching Vite over loopback.
    ...(publicHostname ? { host: '127.0.0.1' } : {}),
    hmr,
    // The launcher calls hostname; localhost and IPs remain Vite defaults.
    allowedHosts,
    proxy: Object.fromEntries(
      routes.map((route) => [
        // Include bare WebSocket paths, but not /authentic or /sync-other.
        `^${route}(?:/|\\?|$)`,
        // Use the backend hostname for TLS SNI/certificate verification;
        // xfwd still records the browser's original host.
        { target, ws: true, xfwd: true, changeOrigin: true },
      ])
    ),
  };
}

function parsePublicHostname(raw: string | undefined): string | undefined {
  if (!raw) return;
  const origin = new URL(raw);
  if (
    origin.protocol !== 'https:' ||
    origin.hostname.startsWith('.') ||
    origin.hostname.includes('*') ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    ![origin.origin, `${origin.origin}/`].includes(raw)
  ) {
    throw new Error('LOCAL_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  return origin.hostname;
}

function validatePublicProxyTarget(raw: string): void {
  const target = new URL(raw);
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      'MACRO_LOCAL_BACKEND_PROXY must be an HTTP(S) loopback origin'
    );
  }
}
