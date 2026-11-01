import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { setPreviewAppearance } from '@queries/preview';
import { readCachedGraphqlItemPreviewFromHost } from '@queries/preview/graphql';
import { previewKeys } from '@queries/preview/keys';
import {
  getSoupEntityById,
  hydrateSoupEntity,
  optimisticUpdateSoupEntity,
} from '@queries/soup/cache';
import { soupKeys } from '@queries/soup/keys';
import { databasesKeys, entityKeys, formsKeys } from '@queries/storage/keys';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas/scheduledAction';
import type { AppearanceEntityType } from '@service-storage/entity-appearance';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import type { QueryClient, QueryKey } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import APPEARANCE_CACHE_WRITE from '../../../lib/service-clients/service-storage/graphql/entity-appearance-cache-write.graphql?raw';
import type { EntityData } from '../../entity/types/entity';
import { scheduledActionKeys } from '../../routines/queries/keys';
import {
  type EntityAppearance,
  sameAppearance,
  supportsEntityAppearance,
} from '../core/appearance';

type Rollback = () => void;

function patchRestReaders(
  queryClient: QueryClient,
  entity: EntityData,
  appearance: EntityAppearance
): Rollback {
  const rollbacks: Rollback[] = [];
  function patch<T>(
    queryKey: QueryKey,
    read: (value: T) => EntityAppearance | null | undefined,
    write: (value: T, next: EntityAppearance | null | undefined) => T
  ) {
    const previous = queryClient.getQueryData<T>(queryKey);
    if (previous === undefined) return;
    const priorAppearance = read(previous);
    queryClient.setQueryData<T>(queryKey, (current) =>
      current === undefined ? current : write(current, appearance)
    );
    rollbacks.push(() => {
      queryClient.setQueryData<T>(queryKey, (current) =>
        current !== undefined && sameAppearance(read(current), appearance)
          ? write(current, priorAppearance)
          : current
      );
    });
  }
  const previewBefore = setPreviewAppearance(entity.id, appearance);
  if (previewBefore !== undefined) {
    rollbacks.push(() => {
      setPreviewAppearance(entity.id, previewBefore.appearance, appearance);
    });
  }
  if (entity.type === 'document') {
    patch<DocumentMetadata>(
      entityKeys.documentMetadata(entity.id).queryKey,
      (value) => value.appearance,
      (value, next) => ({ ...value, appearance: next ?? null })
    );
  }
  if (entity.type === 'document' || entity.type === 'initiative') {
    const current = getSoupEntityById(entity.id);
    if (current) {
      optimisticUpdateSoupEntity({
        tag: entity.type,
        data: { id: entity.id, appearance },
        frecency_score: current.frecency_score,
      });
      const priorSoupAppearance =
        current?.tag === 'document' || current?.tag === 'initiative'
          ? current.data.appearance
          : null;
      rollbacks.push(() => {
        const latest = getSoupEntityById(entity.id);
        if (
          latest &&
          (latest.tag === 'document' || latest.tag === 'initiative') &&
          sameAppearance(latest.data.appearance, appearance)
        ) {
          hydrateSoupEntity({
            tag: entity.type,
            data: { id: entity.id, appearance: priorSoupAppearance ?? null },
            frecency_score: latest.frecency_score,
          });
        }
      });
    }
  }
  if (entity.type === 'routine') {
    patch<ScheduledAction>(
      scheduledActionKeys.detail({ scheduleId: entity.id }).queryKey,
      (value) => value.appearance,
      (value, next) => ({ ...value, appearance: next ?? undefined })
    );
    patch<ScheduledAction[]>(
      scheduledActionKeys.list.queryKey,
      (value) => value.find((item) => item.id === entity.id)?.appearance,
      (value, next) =>
        value.map((item) =>
          item.id === entity.id
            ? { ...item, appearance: next ?? undefined }
            : item
        )
    );
  }
  if (entity.type === 'database') {
    patch<DatabaseDetail>(
      databasesKeys.detail(entity.id).queryKey,
      (value) => value.database.appearance,
      (value, next) => ({
        ...value,
        database: { ...value.database, appearance: next ?? null },
      })
    );
    patch<ListedDatabase[]>(
      databasesKeys.list.queryKey,
      (value) =>
        value.find((item) => item.database.id === entity.id)?.database
          .appearance,
      (value, next) =>
        value.map((item) =>
          item.database.id === entity.id
            ? {
                ...item,
                database: { ...item.database, appearance: next ?? null },
              }
            : item
        )
    );
  }
  if (entity.type === 'form') {
    patch<FormDetail>(
      formsKeys.detail(entity.id).queryKey,
      (value) => value.form.appearance,
      (value, next) => ({
        ...value,
        form: { ...value.form, appearance: next ?? null },
      })
    );
    patch<ListedForm[]>(
      formsKeys.list.queryKey,
      (value) =>
        value.find((item) => item.form.id === entity.id)?.form.appearance,
      (value, next) =>
        value.map((item) =>
          item.form.id === entity.id
            ? { ...item, form: { ...item.form, appearance: next ?? null } }
            : item
        )
    );
    for (const [queryKey] of queryClient.getQueriesData<Form[]>({
      queryKey: formsKeys.forDatabase._def,
    })) {
      patch<Form[]>(
        queryKey,
        (value) => value.find((item) => item.id === entity.id)?.appearance,
        (value, next) =>
          value.map((item) =>
            item.id === entity.id ? { ...item, appearance: next ?? null } : item
          )
      );
    }
  }
  return () => {
    for (const rollback of rollbacks.reverse()) rollback();
  };
}

function appearanceCacheWrite(
  entity: EntityData,
  appearance: EntityAppearance | null
) {
  return {
    query: APPEARANCE_CACHE_WRITE,
    operationName: 'EntityAppearanceCacheWrite',
    data: {
      soupUpdates: {
        __typename: 'SoupUpdated',
        item: {
          __typename:
            entity.type === 'document'
              ? 'GraphqlSoupDocument'
              : 'GraphqlSoupInitiative',
          id: entity.id,
          appearance,
        },
      },
    },
  };
}

type AppearanceWrite = {
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
  return function saveEntityAppearance(
    entity: EntityData,
    appearance: EntityAppearance,
    isCurrent: () => boolean
  ): Promise<Result<void, string>> {
    return Telemetry.span('entity.appearance.apply', async (span) => {
      span.setAttr('entity.id', entity.id);
      span.setAttr('entity.type', entity.type);
      if (!supportsEntityAppearance(entity) || !isCurrent())
        return err(t('appearance.saveFailed'));
      const type = match(entity.type)
        .with('document', 'initiative', 'form', 'database', (type) => type)
        .with('routine', () => 'scheduled_action' as const)
        .otherwise(() => undefined);
      if (!type) return err(t('appearance.saveFailed'));
      const key = `${entity.type}:${entity.id}`;
      const host = sources.cacheHost();
      const keys: QueryKey[] = [
        previewKeys.item(entity.id).queryKey,
        ...(entity.type === 'document'
          ? [entityKeys.documentMetadata(entity.id).queryKey]
          : []),
        ...(entity.type === 'routine'
          ? [
              scheduledActionKeys.detail({ scheduleId: entity.id }).queryKey,
              scheduledActionKeys.list.queryKey,
            ]
          : []),
        ...(entity.type === 'database'
          ? [
              databasesKeys.detail(entity.id).queryKey,
              databasesKeys.list.queryKey,
            ]
          : []),
        ...(entity.type === 'form'
          ? [
              formsKeys.detail(entity.id).queryKey,
              formsKeys.list.queryKey,
              formsKeys.forDatabase._def,
            ]
          : []),
      ];
      const coldKeys =
        entity.type === 'document' || entity.type === 'initiative'
          ? [...keys, soupKeys._def]
          : keys;
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
      const rollbackRest = patchRestReaders(
        sources.queryClient,
        entity,
        appearance
      );
      let graphPrevious: Awaited<
        ReturnType<typeof readCachedGraphqlItemPreviewFromHost>
      >;
      const rollback = async () => {
        rollbackRest();
        const prior = graphPrevious;
        if (host && prior && host === sources.cacheHost() && !host.disabled) {
          await queueWrite(`cache:${key}`, async () => {
            const current = await readCachedGraphqlItemPreviewFromHost(host, {
              id: entity.id,
              type: entity.type === 'initiative' ? 'initiative' : 'document',
            });
            if (
              isCurrent() &&
              host === sources.cacheHost() &&
              current &&
              sameAppearance(current.appearance, appearance)
            ) {
              await host.writeQuery(
                appearanceCacheWrite(entity, prior.appearance ?? null)
              );
            }
          });
        }
      };
      const entry: AppearanceWrite = { rollback, isCurrent, status: 'pending' };
      pending.push(entry);
      // Writes and rollbacks share one queue so overlapping failures unwind in order.
      const graph = queueWrite(`cache:${key}`, async () => {
        if (
          !host ||
          host.disabled ||
          host !== sources.cacheHost() ||
          !isCurrent() ||
          (entity.type !== 'document' && entity.type !== 'initiative')
        )
          return;
        graphPrevious = await readCachedGraphqlItemPreviewFromHost(host, {
          id: entity.id,
          type: entity.type,
        });
        // Only patch loaded records; a failed save must not leave a partial cache entry.
        if (graphPrevious && isCurrent() && host === sources.cacheHost()) {
          await host.writeQuery(appearanceCacheWrite(entity, appearance));
        }
      });
      const cache = Promise.allSettled([graph]);
      // Keep server writes ordered while newer choices are already visible locally.
      const result = await queueWrite(`server:${key}`, async () => {
        if (!isCurrent()) return err(t('appearance.saveFailed'));
        return sources.update(type, entity.id, appearance);
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
          patchRestReaders(sources.queryClient, entity, readers.confirmed);
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
  };
}
