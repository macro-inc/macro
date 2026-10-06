import type { IncomingMessage } from 'node:http';
import type { Plugin, ProxyOptions } from 'vite';
import {
  DEVELOPMENT_PROXY_PREFIX,
  DEVELOPMENT_PROXY_TARGETS,
} from '../src/lib/core/constant/developmentProxy';

/** Keep dev credentials on this hostname while forwarding to fixed hosted APIs. */
export function hostedDevProxy(
  env: Record<string, string | undefined> = process.env,
  targets: Record<string, string> = DEVELOPMENT_PROXY_TARGETS
): Plugin {
  let protocol = 'https';
  const isCrossOrigin = (req: IncomingMessage) =>
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (req.headers.origin !== undefined &&
      req.headers.origin !== `${protocol}://${req.headers.host}`);

  return {
    name: 'macro-hosted-dev-proxy',
    apply: (_config, { command, mode, isPreview }) =>
      command === 'serve' &&
      (env.MODE ?? mode) === 'development' &&
      !isPreview &&
      !env.MACRO_LOCAL_BACKEND_PROXY &&
      !env.TAURI_ENV_PLATFORM &&
      !env.TAURI_DEV_HOST &&
      env.MACRO_DEV_PROXY !== 'false',
    config() {
      return {
        define: { 'import.meta.env.VITE_DEV_PROXY': true },
        server: {
          proxy: Object.fromEntries(
            Object.entries(targets).map(([name, target]) => {
              const prefix = `${DEVELOPMENT_PROXY_PREFIX}/${name}`;
              const options: ProxyOptions = {
                target,
                changeOrigin: true,
                ws: true,
                // Hosted auth cookies have Domain=macro.com. Keep Secure and
                // HttpOnly, but scope them to the visiting development host.
                cookieDomainRewrite: '',
                rewrite: (path) => {
                  const rest = path.slice(prefix.length);
                  return rest.startsWith('/') ? rest : `/${rest}`;
                },
                // isCrossOrigin already vetted the browser's origin. Hosted
                // services allowlist origins (sync-service 403s any https://
                // dev host), so forward like a server-side client.
                configure(proxy) {
                  proxy.on('proxyReq', (request) => {
                    request.removeHeader('origin');
                  });
                  proxy.on('proxyReqWs', (request, req, socket) => {
                    if (isCrossOrigin(req)) {
                      request.destroy();
                      socket.destroy();
                      return;
                    }
                    request.removeHeader('origin');
                  });
                },
              };
              return [`^${prefix}(?:/|\\?|$)`, options];
            })
          ),
        },
      };
    },
    configureServer(server) {
      protocol = server.config.server.https ? 'https' : 'http';
      server.middlewares.use((req, res, next) => {
        if (
          req.url?.startsWith(`${DEVELOPMENT_PROXY_PREFIX}/`) &&
          isCrossOrigin(req)
        ) {
          res.statusCode = 403;
          res.end('Cross-origin development proxy requests are not allowed');
          return;
        }
        next();
      });
    },
  };
}
