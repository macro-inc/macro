import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Website routes run without the app dev server, authentication, or WASM. */
export function standaloneDev(): Plugin {
  return {
    name: 'standalone-website-routes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost')
          .pathname;
        if (
          pathname.startsWith('/@') ||
          pathname.startsWith('/src/') ||
          pathname.startsWith('/node_modules/')
        )
          return next();
        const journey = [
          '/',
          '/start',
          '/start/',
          '/onboarding-preview.html',
        ].includes(pathname);
        if (request.method !== 'GET' || (!journey && path.extname(pathname)))
          return next();
        if (pathname.startsWith('/app')) return next();
        try {
          const entry = journey ? '/start.html' : '/index.html';
          const html = readFileSync(
            path.resolve(import.meta.dirname, '..', `.${entry}`),
            'utf8'
          );
          const output = await server.transformIndexHtml(
            entry,
            html,
            request.url
          );
          response.setHeader('Content-Type', 'text/html');
          response.end(output);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
