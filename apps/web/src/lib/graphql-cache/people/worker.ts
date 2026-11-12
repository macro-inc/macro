import { Telemetry } from '@macro-inc/observability';
import { match } from 'ts-pattern';
import {
  type CachePush,
  type PeopleRequest,
  parseCacheRevision,
  type WriteResult,
} from '../protocol';
import type { CacheEngine } from '../worker/wasm-module';
import { PEOPLE_UNSUPPORTED } from './protocol';

/** Runs after worker queue admission; the upstream id correlates the separate worker runtime. */
export function executePeopleRequest(
  engine: CacheEngine,
  request: PeopleRequest,
  push: (message: CachePush) => void,
  committed: (result: WriteResult) => void
): Promise<unknown> {
  return Telemetry.span('contacts.cache.execute', async (span) => {
    span.setAttr('contacts.operation', request.kind);
    if (request.traceparent)
      span.setAttr('upstream.traceparent', request.traceparent);
    try {
      return await match(request)
        .with({ kind: 'contact-snapshot' }, async ({ request }) => {
          if (!engine.contactSnapshot) return { kind: 'unsupported' };
          return engine.contactSnapshot(request);
        })
        .with({ kind: 'contact-reconcile' }, async ({ request }) => {
          if (!engine.contactReconcile) return { kind: 'unsupported' };
          const result = await engine.contactReconcile(request);
          result.revision = parseCacheRevision(result.revision);
          committed(result);
          return result.revision;
        })
        .with({ kind: 'people-sql' }, async ({ request }) => {
          if (!engine.peopleReadSql) return { kind: 'unsupported' };
          return await engine.peopleReadSql(request);
        })
        .with({ kind: 'people-references' }, async ({ request }) => {
          if (!engine.peopleResolveReferences) return { kind: 'unsupported' };
          return await engine.peopleResolveReferences(request);
        })
        .with({ kind: 'people-context' }, async ({ scope }) => {
          if (
            !engine.peopleContext ||
            !engine.peopleUpdate ||
            !engine.peopleSearch
          )
            return { kind: 'unsupported' };
          return await engine.peopleContext(scope);
        })
        .with({ kind: 'people-search' }, async ({ request }) => {
          if (
            !engine.peopleContext ||
            !engine.peopleUpdate ||
            !engine.peopleSearch
          )
            return { kind: 'unsupported' };
          return await engine.peopleSearch(request);
        })
        .with({ kind: 'people-update' }, async ({ update }) => {
          if (
            !engine.peopleContext ||
            !engine.peopleUpdate ||
            !engine.peopleSearch
          )
            throw new Error(PEOPLE_UNSUPPORTED);
          const result = await engine.peopleUpdate(update);
          const revision = parseCacheRevision(result.revision);
          if (result.revisionAdvanced)
            push({
              kind: 'cache-hydrated',
              revision,
              searchChangedBuckets: ['person'],
            });
          return revision;
        })
        .exhaustive();
    } catch (error) {
      span.error('Contact cache execution failed');
      throw error;
    }
  });
}
