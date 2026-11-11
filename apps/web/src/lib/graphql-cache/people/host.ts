import { Telemetry } from '@macro-inc/observability';
import { type CacheRevision, parseCacheRevision } from '../protocol';
import type {
  ContactReconcile,
  ContactSnapshot,
  ContactSnapshotRequest,
} from './generated';
import {
  isPeopleContextUpdate,
  isPeopleReferenceRequest,
  isPeopleScope,
  isPeopleSearch,
  isPeopleSqlRequest,
  type PeopleContextState,
  type PeopleContextUpdate,
  type PeopleReferenceRequest,
  type PeopleReferenceResult,
  type PeopleScope,
  type PeopleSearch,
  type PeopleSearchResult,
  type PeopleSqlRequest,
  type PeopleSqlResult,
  parsePeopleContext,
  parsePeopleReferenceResult,
  parsePeopleSearchResult,
  parsePeopleSqlResult,
} from './protocol';
import {
  CONTACT_SYNC_UNSUPPORTED,
  isContactReconcile,
  isContactSnapshotRequest,
  parseContactSnapshot,
} from './sync-protocol';

type Unsupported = { kind: 'unsupported' };
export interface PeopleCache {
  snapshot(
    request: ContactSnapshotRequest
  ): Promise<ContactSnapshot | Unsupported>;
  reconcile(request: ContactReconcile): Promise<CacheRevision>;
  readSql(request: PeopleSqlRequest): Promise<PeopleSqlResult>;
  resolveReferences(
    request: PeopleReferenceRequest
  ): Promise<PeopleReferenceResult | Unsupported>;
  context(scope: PeopleScope): Promise<PeopleContextState | Unsupported>;
  update(update: PeopleContextUpdate): Promise<CacheRevision>;
  search(request: PeopleSearch): Promise<PeopleSearchResult | Unsupported>;
}
export interface PeopleTransport {
  snapshot(
    request: ContactSnapshotRequest,
    traceparent?: string
  ): Promise<unknown>;
  reconcile(request: ContactReconcile, traceparent?: string): Promise<unknown>;
  readSql(request: PeopleSqlRequest, traceparent?: string): Promise<unknown>;
  resolveReferences(
    request: PeopleReferenceRequest,
    traceparent?: string
  ): Promise<unknown>;
  context(scope: PeopleScope, traceparent?: string): Promise<unknown>;
  update(update: PeopleContextUpdate, traceparent?: string): Promise<unknown>;
  search(request: PeopleSearch, traceparent?: string): Promise<unknown>;
}
function unsupported(value: unknown): value is Unsupported {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'unsupported'
  );
}

/** Both hosts validate the same generated wire contract; telemetry never includes people/query text. */
export function createPeopleCache(transport: PeopleTransport): PeopleCache {
  return {
    async snapshot(request) {
      if (!isContactSnapshotRequest(request))
        throw new Error('Invalid contact snapshot request');
      return Telemetry.span('contacts.cache.snapshot', async (span) => {
        span.setAttr(
          'cache.storage_generation',
          request.scope.storageGeneration
        );
        try {
          const value = await transport.snapshot(request, span.traceparent());
          const result = unsupported(value)
            ? { kind: 'unsupported' as const }
            : parseContactSnapshot(value);
          if ('ids' in result) {
            if (result.ids.length > (request.scan?.limit ?? 0))
              throw new Error('Invalid contact snapshot window');
            span.setAttr('contacts.batch_count', result.ids.length);
          }
          return result;
        } catch (error) {
          span.error('Contact snapshot failed');
          throw error;
        }
      });
    },
    async reconcile(request) {
      if (!isContactReconcile(request))
        throw new Error('Invalid contact reconciliation');
      return Telemetry.span('contacts.cache.reconcile', async (span) => {
        span.setAttr(
          'cache.storage_generation',
          request.scope.storageGeneration
        );
        span.setAttr('contacts.requested_count', request.requested.length);
        span.setAttr('contacts.present_count', request.present.length);
        try {
          const value = await transport.reconcile(request, span.traceparent());
          if (unsupported(value)) throw new Error(CONTACT_SYNC_UNSUPPORTED);
          return parseCacheRevision(value);
        } catch (error) {
          span.error('Contact reconciliation failed');
          throw error;
        }
      });
    },
    async readSql(request) {
      if (!isPeopleSqlRequest(request))
        throw new Error('Invalid local people SQL request');
      return Telemetry.span('contacts.cache.sql', async (span) => {
        span.setAttr(
          'cache.storage_generation',
          request.scope.storageGeneration
        );
        span.setAttr('contacts.sql_kind', request.input.kind);
        try {
          const result = parsePeopleSqlResult(
            await transport.readSql(request, span.traceparent())
          );
          span.setAttr('contacts.outcome', result.kind);
          if (result.kind === 'result')
            span.setAttr('contacts.result_count', result.outcome.rows.length);
          return result;
        } catch (error) {
          span.error('Local contact SQL failed');
          throw error;
        }
      });
    },
    async resolveReferences(request) {
      if (!isPeopleReferenceRequest(request))
        throw new Error('Invalid contact reference request');
      return Telemetry.span(
        'contacts.cache.resolve_references',
        async (span) => {
          span.setAttr(
            'cache.storage_generation',
            request.scope.storageGeneration
          );
          span.setAttr('contacts.reference_count', request.labels.length);
          span.setAttr('contacts.reference_matching', request.matching);
          try {
            const value = await transport.resolveReferences(
              request,
              span.traceparent()
            );
            const result = unsupported(value)
              ? value
              : parsePeopleReferenceResult(value);
            if (
              result.kind === 'resolved' &&
              result.matches.length !== request.labels.length
            )
              throw new Error('Invalid contact reference response');
            span.setAttr('contacts.outcome', result.kind);
            if (result.kind === 'resolved')
              span.setAttr(
                'contacts.ambiguous_count',
                result.matches.filter((entry) => entry.people.length > 1).length
              );
            return result;
          } catch (error) {
            span.error('Contact reference resolution failed');
            throw error;
          }
        }
      );
    },
    async context(scope) {
      if (!isPeopleScope(scope))
        throw new Error('Invalid contact context scope');
      return Telemetry.span('contacts.cache.context', async (span) => {
        span.setAttr('cache.storage_generation', scope.storageGeneration);
        try {
          const value = await transport.context(scope, span.traceparent());
          const result = unsupported(value) ? value : parsePeopleContext(value);
          span.setAttr('contacts.context', result.kind);
          return result;
        } catch (error) {
          span.error('Contact context read failed');
          throw error;
        }
      });
    },
    async update(update) {
      if (!isPeopleContextUpdate(update))
        throw new Error('Invalid contact context update');
      return Telemetry.span('contacts.cache.update', async (span) => {
        span.setAttr(
          'cache.storage_generation',
          update.scope.storageGeneration
        );
        span.setAttr('contacts.context_epoch', update.epoch);
        span.setAttr('contacts.action', update.action.kind);
        if (update.action.kind === 'patch')
          span.setAttr('contacts.patch_count', update.action.updates.length);
        try {
          return parseCacheRevision(
            await transport.update(update, span.traceparent())
          );
        } catch (error) {
          span.error('Contact context update failed');
          throw error;
        }
      });
    },
    async search(request) {
      if (!isPeopleSearch(request))
        throw new Error('Invalid contact search request');
      return Telemetry.span('contacts.cache.search', async (span) => {
        span.setAttr(
          'cache.storage_generation',
          request.scope.storageGeneration
        );
        span.setAttr('contacts.mode', request.mode);
        span.setAttr('contacts.query_length', request.query.length);
        span.setAttr('contacts.limit', request.limit);
        try {
          const value = await transport.search(request, span.traceparent());
          const result = unsupported(value)
            ? value
            : parsePeopleSearchResult(value);
          span.setAttr('contacts.outcome', result.kind);
          if (result.kind === 'page')
            span.setAttr('contacts.result_count', result.people.length);
          return result;
        } catch (error) {
          span.error('Contact search failed');
          throw error;
        }
      });
    },
  };
}
