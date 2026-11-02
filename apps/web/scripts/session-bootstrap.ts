import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Independent async entry: HTML module scripts otherwise share one deferred graph. */
export function sessionBootstrap(): Plugin {
  let entry: string;
  let base: string;
  let html: string;
  let building = false;
  return {
    name: 'session-bootstrap',
    configResolved(config) {
      entry = resolve(config.root, 'src/session-bootstrap.ts');
      html = resolve(config.root, 'index.html');
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
      building = config.command === 'build';
    },
    buildStart() {
      if (building) this.emitFile({ type: 'chunk', id: entry, name: 'session-bootstrap' });
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        if (context.filename !== html) return;
        const chunk = Object.values(context.bundle ?? {}).find(
          file => file.type === 'chunk' && file.facadeModuleId === entry
        );
        if (building && !chunk) throw new Error('Missing session bootstrap entry');
        const src = building && chunk ? `${base}${chunk.fileName}` : '/src/session-bootstrap.ts';
        return [{ tag: 'script', attrs: { type: 'module', async: true, src }, injectTo: 'head' }];
      },
    },
  };
}
