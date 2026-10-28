import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Website routes run without the app dev server, authentication, or WASM. */
export function standaloneDev(): Plugin {
  return {
    name: 'standalone-website-routes',
    apply: 'serve',
    configurePreviewServer(server) {
      const directory = path.resolve(
        server.config.root,
        server.config.build.outDir
      );
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        if (
          !['GET', 'HEAD'].includes(request.method ?? '') ||
          path.extname(pathname) ||
          pathname === '/app' ||
          pathname.startsWith('/app/')
        )
          return next();
        const filename = path.resolve(directory, `.${pathname}`, 'index.html');
        if (
          !filename.startsWith(`${directory}${path.sep}`) ||
          !existsSync(filename)
        ) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }
        // Match the production CDN's directory-index rewrite, rather than
        // Vite's SPA fallback to the homepage's separate hydration entry.
        request.url = `${pathname.replace(/\/$/, '')}/index.html${url.search}`;
        next();
      });
    },
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
