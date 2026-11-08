import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { database, devSecret, syncUrl } from './access';
import { object } from './scan';
import { directory, openCache } from './store';

// Every query is paginated by its primary key, never names or owners.
const sources = {
  document: `SELECT json_build_object('id',id) FROM "Document" WHERE "fileType"='md' AND "deletedAt" IS NULL AND id > :'cursor' ORDER BY id LIMIT 100;`,
  surface: `SELECT json_build_object('id',id) FROM collab_surfaces WHERE state='ready' AND deleted_at IS NULL AND (NULLIF(:'cursor','') IS NULL OR id > NULLIF(:'cursor','')::uuid) ORDER BY id LIMIT 100;`,
  chat: `SELECT json_build_object('id',id,'content',content) FROM "ChatMessage" WHERE id > :'cursor' AND content::text LIKE '%"root"%' ORDER BY id LIMIT 100;`,
  channel: `SELECT json_build_object('id',id,'content',content) FROM comms_messages WHERE (NULLIF(:'cursor','') IS NULL OR id > NULLIF(:'cursor','')::uuid) AND deleted_at IS NULL AND content LIKE '%"root"%' ORDER BY id LIMIT 100;`,
};

function states(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') {
    try {
      return states(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(states);
  if (!object(value)) return [];
  if (object(value.root) && value.root.type === 'root') return [value];
  return Object.values(value).flatMap(states);
}

export async function pull() {
  const sql = database();
  const auth = devSecret('SYNC_SERVICE_AUTH_KEY');
  const cache = openCache();
  const result: Record<
    string,
    {
      listed: number;
      stored: number;
      cached: number;
      unavailable: number;
      invalid: number;
    }
  > = {};
  for (const [source, query] of Object.entries(sources)) {
    const counts = {
      listed: 0,
      stored: 0,
      cached: 0,
      unavailable: 0,
      invalid: 0,
    };
    result[source] = counts;
    let cursor = '';
    for (;;) {
      const rows = sql(query, cursor);
      if (!rows.length) break;
      for (const row of rows) {
        if (!object(row) || typeof row.id !== 'string')
          throw new Error('Invalid dev inventory');
        cursor = row.id;
        counts.listed++;
        const name =
          createHash('sha256').update(`${source}:${row.id}`).digest('hex') +
          '.enc';
        if (existsSync(join(directory, name))) {
          counts.cached++;
          continue;
        }
        let raw: string;
        if (source === 'document' || source === 'surface') {
          // Intentionally no SyncServiceClient: its failure path prints response bodies.
          await Bun.sleep(250);
          let response: Response;
          try {
            response = await fetch(
              `${syncUrl}/document/${encodeURIComponent(row.id)}/raw`,
              {
                method: 'GET',
                redirect: 'error',
                headers: {
                  'x-internal-auth-key': auth,
                  'user-agent': 'macro-lexical-corpus/1.0',
                  accept: 'application/json',
                },
                signal: AbortSignal.timeout(10000),
              }
            );
          } catch {
            counts.unavailable++;
            continue;
          }
          // Authentication failures are a global blocker, not missing documents.
          if (response.status === 401 || response.status === 403)
            throw new Error('Dev sync-service access required');
          if (!response.ok) {
            counts.unavailable++;
            continue;
          }
          raw = await response.text();
        } else raw = JSON.stringify(row.content);
        let documents: Record<string, unknown>[];
        try {
          documents = states(JSON.parse(raw));
        } catch {
          counts.invalid++;
          continue;
        }
        if (!documents.length) {
          counts.invalid++;
          continue;
        }
        // Preserve the raw JSON too: R-5 must examine source escapes before Rust decoding.
        cache.write(name, { source, id: row.id, raw, documents });
        counts.stored++;
      }
      await Bun.sleep(250);
    }
  }
  return result;
}
