import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));

/** A document-scoped JWT signed with the local test secret. */
export function syncToken(documentId: string, user: string, access = 'edit') {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      document_id: documentId,
      user_id: user,
      access_level: access,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', 'local')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Boot the compiled Rust sync Worker in an isolated Miniflare instance. Build
 * `services/sync-service/build/worker/shim.mjs` first (`just worker-build`).
 */
export async function startSyncServer() {
  const syncPath = `${root}/services/sync-service`;
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
    d1Databases: { USER_PEER_MAPPING: 'docx-test' },
    r2Buckets: { DOCUMENT_SNAPSHOT_BUCKET: 'docx-test' },
    kvNamespaces: {
      DOCUMENT_VERSIONING_KV: 'versions',
      SNAPSHOT_STORE_KV: 'snapshots',
    },
    bindings: {
      DOCUMENT_PERMISSIONS_SECRET: 'local',
      INTERNAL_API_SECRET_KEY: 'INTERNAL_API_SECRET',
      INTERNAL_API_SECRET: 'local',
      SPS_API_SECRET_KEY: 'local',
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

/** Fixture URL for one collaborator on `documentId`. */
export function fixtureUrl(
  base: string,
  serverUrl: string,
  documentId: string,
  user: string,
  extra: Record<string, string> = {}
) {
  const token = syncToken(documentId, user);
  return `${base}/?${new URLSearchParams({
    document: documentId,
    worker: serverUrl,
    socket: `${serverUrl.replace('http:', 'ws:')}document/${documentId}/connect?token=${token}`,
    token,
    user,
    ...extra,
  })}`;
}
