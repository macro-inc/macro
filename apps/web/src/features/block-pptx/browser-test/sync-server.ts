/**
 * The real sync service for browser tests: the compiled Rust Worker in an
 * isolated Miniflare instance, with a document JWT signed by its test secret.
 * Build the Worker first: `(\cd services/sync-service && just worker-build)`.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const SECRET = 'local';

/** A document-scoped JWT for `user`. */
export function syncToken(documentId: string, user: string, access = 'edit') {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    document_id: documentId,
    user_id: user,
    access_level: access,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signature = createHmac('sha256', SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Boots the Worker; resolves with its base URL (ending in `/`). */
export async function startSyncServer() {
  const syncPath = `${root}services/sync-service`;
  const server = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    scriptPath: `${syncPath}/build/worker/shim.mjs`,
    modules: true,
    modulesRoot: syncPath,
    modulesRules: [
      { type: 'ESModule', include: ['**/build/index.js'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true },
    ],
    compatibilityDate: '2025-03-05',
    durableObjects: {
      DOCUMENT_SYNC_SESSION: {
        className: 'DocumentSyncSession',
        useSQLite: true,
      },
    },
    d1Databases: { USER_PEER_MAPPING: 'pptx-test' },
    r2Buckets: { DOCUMENT_SNAPSHOT_BUCKET: 'pptx-test' },
    kvNamespaces: {
      DOCUMENT_VERSIONING_KV: 'versions',
      SNAPSHOT_STORE_KV: 'snapshots',
    },
    bindings: {
      DOCUMENT_PERMISSIONS_SECRET: SECRET,
      INTERNAL_API_SECRET_KEY: 'INTERNAL_API_SECRET',
      INTERNAL_API_SECRET: SECRET,
      SPS_API_SECRET_KEY: SECRET,
      SPS_URL: 'http://discard.test',
      local: true,
    },
    outboundService: async () => new Response(null, { status: 204 }),
  });
  const url = (await server.ready).toString();
  const db = await server.getD1Database('USER_PEER_MAPPING');
  for (const file of ['0001_add_users.sql', '0002_add_blame.sql']) {
    const sql = readFileSync(
      `${syncPath}/database/user-peer-mapping/migrations/${file}`,
      'utf8'
    );
    for (const statement of sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
  return { server, url };
}

/** The fixture URL for one collaborator on `documentId`. */
export function collaboratorUrl(
  base: string,
  serverUrl: string,
  documentId: string,
  user: string,
  deck: string
) {
  const token = syncToken(documentId, user);
  return `${base}/?${new URLSearchParams({
    deck,
    document: documentId,
    worker: serverUrl,
    socket: `${serverUrl.replace('http:', 'ws:')}document/${documentId}/connect?token=${token}`,
    token,
    user,
  })}`;
}
