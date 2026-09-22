import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import type { Plugin } from 'vite';

const pages = new Set(['email', 'tasks', 'channels', 'documents', 'calls', 'crm', 'agents', 'github', 'pricing', 'partners', 'posts', 'migrate', 'startups', 'jobs', 'terms', 'privacy', 'dpa', 'mobile-signup', 'mobile-signup-sent']);

/** Serve the public site and the authenticated app from the same local origin. */
export function marketingDev(): Plugin {
  const servePublic = sirv(fileURLToPath(new URL('../marketing/public', import.meta.url)), { dev: true });
  const assets = new Set(readdirSync(new URL('../marketing/public', import.meta.url)));
  return {
    name: 'macro-marketing-pages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const first = url.pathname.split('/')[1];
        const journey = url.pathname === '/' || url.pathname === '/start' || url.pathname === '/start/';
        const marketing = pages.has(first) && !url.pathname.includes('.');
        if ((journey || marketing) && request.method === 'GET') {
          const htmlPath = journey ? '/onboarding-preview.html' : '/marketing/index.html';
          const file = new URL(`..${htmlPath}`, import.meta.url);
          const html = readFileSync(file, 'utf8').replace('./src/app/main/index.tsx', '/marketing/src/app/main/index.tsx');
          void server.transformIndexHtml(htmlPath, html, request.url).then((output) => {
            _response.setHeader('Content-Type', 'text/html');
            _response.end(output);
          }).catch(next);
          return;
        } else if (assets.has(first)) {
          servePublic(request, _response, next);
          return;
        }
        next();
      });
    },
  };
}
