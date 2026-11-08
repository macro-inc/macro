import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { database, devSecret, documentToken, syncUrl } from './access';
import { object } from './scan';
import { directory, openCache } from './store';

/** A bounded recent sample; the database returns ids only. */
export async function pull() {
  const sql = database();
  const key = devSecret('DOCUMENT_PERMISSION_JWT');
  const cache = openCache();
  const rows = sql(
    `SELECT json_build_object('id',id) FROM "Document" WHERE "fileType"='md' AND "deletedAt" IS NULL ORDER BY "updatedAt" DESC, id LIMIT 2000;`,
    ''
  );
  const counts = {
    listed: rows.length,
    stored: 0,
    cached: 0,
    unavailable: 0,
    invalid: 0,
  };
  for (const row of rows) {
    if (!object(row) || typeof row.id !== 'string')
      throw new Error('Invalid dev inventory');
    const name =
      createHash('sha256').update(`document:${row.id}`).digest('hex') + '.enc';
    if (existsSync(join(directory, name))) {
      counts.cached++;
      continue;
    }
    await Bun.sleep(250);
    let response: Response;
    try {
      response = await fetch(
        `${syncUrl}/document/${encodeURIComponent(row.id)}/raw`,
        {
          method: 'GET',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${documentToken(row.id, key)}`,
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
    if (response.status === 401 || response.status === 403)
      throw new Error('Dev sync-service access required');
    if (!response.ok) {
      counts.unavailable++;
      continue;
    }
    const raw = await response.text();
    let state: unknown;
    try {
      state = JSON.parse(raw);
    } catch {
      counts.invalid++;
      continue;
    }
    if (!object(state) || !object(state.root) || state.root.type !== 'root') {
      counts.invalid++;
      continue;
    }
    cache.write(name, {
      source: 'document',
      id: row.id,
      raw,
      documents: [state],
    });
    counts.stored++;
  }
  return counts;
}
