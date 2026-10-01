// Local browser harness for a new native-protocol document. No app data is used.
import jwt from 'jsonwebtoken';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:24209/sync';
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'browser-smoke.ts')],
  target: 'browser',
  plugins: [{ name: 'automerge-browser-wasm', setup(build) {
    build.onResolve({ filter: /^@automerge\/automerge$/ }, () => ({
      path: resolve(import.meta.dir, '../node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js'),
    }));
  } }],
});
if (!bundle.success) throw new Error(bundle.logs.join('\n'));
Bun.serve({
  hostname: '127.0.0.1', port: 3000,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const id = crypto.randomUUID();
    if (path === '/config') return Response.json({ base, id, token: jwt.sign({
      user_id: 'automerge-browser-smoke', document_id: id, access_level: 'owner',
    }, 'local', { expiresIn: '5m' }) });
    if (path === '/smoke.js') return new Response(bundle.outputs[0], { headers: { 'Content-Type': 'text/javascript' } });
    return new Response('<!doctype html><title>Automerge sync smoke</title><body style="white-space:pre-wrap">Testing native sync…<script type="module" src="/smoke.js"></script>', { headers: { 'Content-Type': 'text/html' } });
  },
});
console.log(`Browser smoke: http://localhost:3000 → ${base}`);
