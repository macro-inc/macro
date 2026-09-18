import type { ServerOptions } from 'vite';

// Mirrors the local Caddy inventory and its explicit non-Rust routes. Never
// forward /app, /@vite, source modules, or arbitrary paths back to Caddy.
export const LOCAL_BACKEND_ROUTES = [
  'auth',
  'connection-gateway',
  'contacts',
  'cognition',
  'dss',
  'email',
  'notification',
  'scheduled-action',
  'unfurl',
  'image-proxy',
  'agent-harness',
  'websocket',
  'sync',
  'i',
  'lexical',
  'ai-editing',
  'static-file',
  's3',
  'oauth2',
];

type LocalProxyOptions = {
  publicOrigin?: string;
  proxyTarget?: string;
  tauriHost?: string;
};

export function localPublicOriginServer({
  publicOrigin,
  proxyTarget,
  tauriHost,
}: LocalProxyOptions): Pick<
  ServerOptions,
  'host' | 'allowedHosts' | 'hmr' | 'proxy'
> {
  const hmr = tauriHost ? { host: tauriHost } : undefined;
  if (!publicOrigin) return { hmr };

  const origin = new URL(publicOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.hostname.startsWith('.') ||
    origin.hostname.includes('*') ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    ![origin.origin, `${origin.origin}/`].includes(publicOrigin)
  ) {
    throw new Error('LOCAL_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  if (!proxyTarget) {
    throw new Error(
      'LOCAL_BACKEND_PROXY_TARGET is required for public-origin Vite'
    );
  }
  const target = new URL(proxyTarget);
  if (
    target.protocol !== 'http:' ||
    target.hostname !== '127.0.0.1' ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      'LOCAL_BACKEND_PROXY_TARGET must be an HTTP loopback origin'
    );
  }
  return {
    // Tailscale Serve owns the tailnet address on this port. Binding all
    // interfaces would collide with it; the TLS proxy connects over loopback.
    host: '127.0.0.1',
    allowedHosts: [origin.hostname],
    // Leave protocol/host/port unset: Vite infers wss and the public port from
    // its browser URL. A forced localhost/ws HMR endpoint breaks HTTPS.
    hmr: undefined,
    proxy: Object.fromEntries(
      LOCAL_BACKEND_ROUTES.map((route) => [
        `^/${route}(?:/|\\?|$)`,
        { target: target.origin, ws: true, changeOrigin: false },
      ])
    ),
  };
}
