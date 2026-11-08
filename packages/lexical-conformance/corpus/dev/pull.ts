import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { devSecret, documentToken, syncUrl } from './access';
import { sampleIds } from './sample';
import { object } from './scan';
import { directory, openCache } from './store';
import { flushTrace, startTrace } from './telemetry';

/** A bounded recent sample; the database returns ids only. */
export async function pull() {
  const trace = await startTrace('lexical.corpus.pull');
  try {
    const key = devSecret('DOCUMENT_PERMISSION_JWT');
    const cache = openCache();
    const rows = sampleIds(true).map((id) => ({ id }));
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
        createHash('sha256').update(`document:${row.id}`).digest('hex') +
        '.enc';
      if (existsSync(join(directory, name))) {
        counts.cached++;
        continue;
      }
      await Bun.sleep(250);
      let response: Response;
      const span = trace.span('lexical.corpus.fetch');
      span.setAttr('document_id', name.slice(0, -4));
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${documentToken(row.id, key)}`,
          'user-agent': 'macro-lexical-corpus/1.0',
          accept: 'application/json',
        };
        span.injectTraceHeaders(headers);
        response = await fetch(
          `${syncUrl}/document/${encodeURIComponent(row.id)}/raw`,
          {
            method: 'GET',
            redirect: 'error',
            headers,
            signal: AbortSignal.timeout(10000),
          }
        );
        span.setAttr('http.response.status_code', response.status);
      } catch {
        counts.unavailable++;
        continue;
      } finally {
        span.end();
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
    trace.setAttr('corpus.stored', counts.stored);
    trace.setAttr('corpus.listed', counts.listed);
    return counts;
  } finally {
    trace.end();
    await flushTrace();
  }
}
