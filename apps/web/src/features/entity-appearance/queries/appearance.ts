import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { previewKeys } from '@queries/preview/keys';
import { soupKeys } from '@queries/soup/keys';
import type { AppearanceEntityType } from '@service-storage/entity-appearance';
import {
  type EntityAppearanceCacheWriteSubscription,
  EntityAppearanceFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import type { QueryClient, QueryKey } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import APPEARANCE_CACHE_WRITE from '../../../lib/service-clients/service-storage/graphql/entity-appearance-cache-write.graphql?raw';
import type { EntityData } from '../../entity/types/entity';
import {
  type EntityAppearance,
  readEntityAppearance,
  sameAppearance,
  supportsEntityAppearance,
} from '../core/appearance';
import {
  appearanceAdapter,
  patchAppearanceReaders,
  type SoupAppearanceTarget,
} from './appearance-readers';
import {
  type AppearanceMutationVariables,
  ENTITY_APPEARANCE_MUTATION_KEY,
} from './pending-appearance';

const appearanceSelection = selectRecords(EntityAppearanceFieldsFragmentDoc);

async function readCachedAppearance(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  id: string,
  soup: SoupAppearanceTarget
) {
  const result = await readRecordsByKeys(host, appearanceSelection, [
    `${soup.typename}:${id}`,
  ]);
  const record = result.records[0]?.record;
  if (
    record?.__typename === 'GraphqlSoupDocument' ||
    record?.__typename === 'GraphqlSoupInitiative'
  ) {
    return { appearance: readEntityAppearance(record.appearance) };
  }
}

function appearanceCacheWrite(
  soup: SoupAppearanceTarget,
  id: string,
  appearance: EntityAppearance | null
) {
  return {
    query: APPEARANCE_CACHE_WRITE,
    operationName: 'EntityAppearanceCacheWrite',
    data: {
      soupUpdates: [
        {
          __typename: 'SoupUpdated',
          item: {
            __typename: soup.typename,
            id,
            appearance,
          },
        },
      ],
    } satisfies EntityAppearanceCacheWriteSubscription,
  };
}

type AppearanceWrite = {
  appearance: EntityAppearance;
  rollback: () => Promise<void>;
  isCurrent: () => boolean;
  status: 'pending' | 'failed' | 'success';
};
type AppearanceReaders = {
  token: object;
  isCurrent: () => boolean;
  confirmed?: EntityAppearance;
};
export function createSaveEntityAppearance(sources: {
  queryClient: QueryClient;
  cacheHost: () =>
    | Pick<CacheHost, 'disabled' | 'writeQuery' | 'readRecordsByKeys'>
    | undefined;
  update: (
    type: AppearanceEntityType,
    id: string,
    appearance: EntityAppearance
  ) => Promise<Result<unknown, unknown>>;
  refreshUncached?: (entity: EntityData) => Promise<void>;
  acknowledgeWrite?: (host: object) => void;
}) {
  // Keep only overlapping writes. Their rollback closures change appearance fields,
  // never entire query snapshots or unrelated metadata.
  const writes = new Map<string, AppearanceWrite[]>();
  const writeQueues = new Map<string, Promise<void>>();
  const readerWrites = new Map<string, AppearanceReaders>();
  function queueWrite<T>(key: string, write: () => Promise<T>) {
    const previous = writeQueues.get(key);
    const next = (async () => {
      if (previous) await previous;
      return await write();
    })();
    async function settle() {
      await Promise.allSettled([next]);
      if (writeQueues.get(key) === settled) writeQueues.delete(key);
    }
    const settled = settle();
    writeQueues.set(key, settled);
    return next;
  }
  function saveEntityAppearance(
    entity: EntityData,
    appearance: EntityAppearance,
    isCurrent: () => boolean,
    onRevalidationError: () => void
  ): Promise<Result<void, string>> {
    return Telemetry.span('entity.appearance.apply', async (span) => {
      span.setAttr('entity.id', entity.id);
      span.setAttr('entity.type', entity.type);
      if (!supportsEntityAppearance(entity) || !isCurrent())
        return err(t('appearance.saveFailed'));
      const adapter = appearanceAdapter(
        sources.queryClient,
        entity.type,
        entity.id
      );
      const soup = adapter.soup;
      const key = `${entity.type}:${entity.id}`;
      const host = sources.cacheHost();
      const keys: QueryKey[] = [
        previewKeys.item(entity.id).queryKey,
        ...adapter.readers.map((reader) => reader.key),
      ];
      const coldKeys = soup ? [...keys, soupKeys._def] : keys;
      const coldReads = Promise.allSettled(
        coldKeys.flatMap((queryKey) =>
          sources.queryClient
            .getQueryCache()
            .findAll({
              queryKey,
              predicate: (query) =>
                query.state.data === undefined &&
                query.state.fetchStatus === 'fetching',
            })
            .flatMap((query) => (query.promise ? [query.promise] : []))
        )
      );
      await Promise.all(
        keys.map((queryKey) =>
          sources.queryClient.cancelQueries({
            queryKey,
            predicate: (query) => query.state.data !== undefined,
          })
        )
      );
      if (!isCurrent()) return err(t('appearance.saveFailed'));
      const token = {};
      const previousReaders = readerWrites.get(key);
      const readers: AppearanceReaders = previousReaders?.isCurrent()
        ? previousReaders
        : { token, isCurrent };
      readers.token = token;
      readerWrites.set(key, readers);
      const previousWrites = writes.get(key);
      const pending = previousWrites?.every((write) => write.isCurrent())
        ? previousWrites
        : [];
      writes.set(key, pending);
      const rollbackRest = patchAppearanceReaders(
        adapter,
        entity.id,
        appearance
      );
      let graphPrevious: Awaited<ReturnType<typeof readCachedAppearance>>;
      const rollback = async () => {
        rollbackRest();
        const prior = graphPrevious;
        if (
          host &&
          soup &&
          prior &&
          host === sources.cacheHost() &&
          !host.disabled
        ) {
          await queueWrite(`cache:${key}`, async () => {
            const current = await readCachedAppearance(host, entity.id, soup);
            if (
              isCurrent() &&
              host === sources.cacheHost() &&
              current &&
              sameAppearance(current.appearance, appearance)
            ) {
              await host.writeQuery(
                appearanceCacheWrite(soup, entity.id, prior.appearance ?? null)
              );
            }
          });
        }
      };
      const entry: AppearanceWrite = {
        appearance,
        rollback,
        isCurrent,
        status: 'pending',
      };
      pending.push(entry);
      // Writes and rollbacks share one queue so overlapping failures unwind in order.
      const graph = queueWrite(`cache:${key}`, async () => {
        if (
          !host ||
          host.disabled ||
          host !== sources.cacheHost() ||
          !isCurrent() ||
          !soup
        )
          return;
        graphPrevious = await readCachedAppearance(host, entity.id, soup);
        // Only patch loaded records; a failed save must not leave a partial cache entry.
        if (graphPrevious && isCurrent() && host === sources.cacheHost()) {
          await host.writeQuery(
            appearanceCacheWrite(soup, entity.id, appearance)
          );
        }
      });
      const cache = Promise.allSettled([graph]);
      // Keep server writes ordered while newer choices are already visible locally.
      const result = await queueWrite(`server:${key}`, async () => {
        if (!isCurrent()) return err(t('appearance.saveFailed'));
        const result = await sources.update(
          adapter.apiType,
          entity.id,
          appearance
        );
        await cache;
        if (result.isErr() || !isCurrent()) return result;
        let reconciled = false;
        if (host && !host.disabled && host === sources.cacheHost() && soup) {
          sources.acknowledgeWrite?.(host);
          const confirmed = await Promise.allSettled([
            queueWrite(`cache:${key}`, async () => {
              const current = await readCachedAppearance(host, entity.id, soup);
              if (
                !current ||
                !isCurrent() ||
                host !== sources.cacheHost() ||
                host.disabled
              )
                return false;
              const latest = pending.findLast(
                (write) => write.status === 'pending' && write.isCurrent()
              );
              await host.writeQuery(
                appearanceCacheWrite(
                  soup,
                  entity.id,
                  latest?.appearance ?? appearance
                )
              );
              return true;
            }),
          ]);
          reconciled =
            confirmed[0]?.status === 'fulfilled' && confirmed[0].value;
        }
        if (!reconciled) {
          const refreshed = await Promise.allSettled([
            sources.refreshUncached?.(entity),
          ]);
          if (refreshed[0]?.status === 'rejected') {
            onRevalidationError();
            Telemetry.warn('appearance fallback reconciliation failed', {
              entity_type: entity.type,
            });
          }
        }
        return result;
      });
      if (result.isOk() && isCurrent()) readers.confirmed = appearance;
      const cacheResults = await cache;
      if (cacheResults[0]?.status === 'rejected') {
        Telemetry.warn('appearance cache reconciliation failed', {
          entity_type: entity.type,
        });
      }
      entry.status = result.isErr() ? 'failed' : 'success';
      if (isCurrent()) {
        const rollbacks: Promise<void>[] = [];
        // Retire completed writes from the top. Failed older edits stay beneath
        // pending newer edits so a later failure can unwind both in order.
        while (
          pending.length &&
          pending[pending.length - 1]?.status !== 'pending'
        ) {
          const latest = pending.pop();
          // A confirmed newer edit supersedes every older rollback, even if
          // both edits selected the same icon and color.
          if (latest?.status === 'success') {
            pending.length = 0;
            break;
          }
          if (latest?.status === 'failed') rollbacks.push(latest.rollback());
        }
        if (!pending.length && writes.get(key) === pending) writes.delete(key);
        await Promise.allSettled(rollbacks);
      } else if (writes.get(key) === pending) {
        writes.delete(key);
      }
      const reconcileReaders = () => {
        if (
          isCurrent() &&
          readerWrites.get(key) === readers &&
          readers.token === token &&
          readers.confirmed
        ) {
          patchAppearanceReaders(adapter, entity.id, readers.confirmed);
        }
      };
      reconcileReaders();
      async function finishColdReads() {
        await coldReads;
        reconcileReaders();
        if (readerWrites.get(key) === readers && readers.token === token)
          readerWrites.delete(key);
      }
      fireAndForget(finishColdReads(), 'appearance cold reader reconciliation');
      if (result.isErr()) {
        span.error('appearance update failed');
        return err(t('appearance.saveFailed'));
      }
      return ok(undefined);
    });
  }
  const mutationFn = (variables: AppearanceMutationVariables) =>
    saveEntityAppearance(
      variables.entity,
      variables.appearance,
      variables.isCurrent,
      () => {
        variables.retainAfterSave = true;
      }
    );
  return async (
    entity: EntityData,
    appearance: EntityAppearance,
    isCurrent: () => boolean
  ): Promise<Result<void, string>> => {
    const mutation = sources.queryClient
      .getMutationCache()
      .build(sources.queryClient, {
        mutationKey: ENTITY_APPEARANCE_MUTATION_KEY,
        mutationFn,
        retry: false,
      });
    const variables: AppearanceMutationVariables = {
      entity,
      appearance,
      isCurrent,
    };
    try {
      const result = await mutation.execute(variables);
      if (result.isOk()) {
        const cache = sources.queryClient.getMutationCache();
        for (const previous of cache.findAll({
          mutationKey: ENTITY_APPEARANCE_MUTATION_KEY,
          status: 'success',
        })) {
          const previousVariables = previous.state.variables as
            | AppearanceMutationVariables
            | undefined;
          if (
            previous.mutationId < mutation.mutationId &&
            previousVariables?.entity.id === entity.id &&
            previousVariables.entity.type === entity.type
          )
            cache.remove(previous);
        }
      }
      return result;
    } finally {
      if (!variables.retainAfterSave)
        sources.queryClient.getMutationCache().remove(mutation);
    }
  };
}
