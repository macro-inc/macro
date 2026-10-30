import { t } from '@app/lib/i18n';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { setPreviewAppearance } from '@queries/preview';
import { getSoupEntityById, hydrateSoupEntity } from '@queries/soup/cache';
import { databasesKeys, entityKeys, formsKeys } from '@queries/storage/keys';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas/scheduledAction';
import type { AppearanceEntityType } from '@service-storage/entity-appearance';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import type { QueryClient } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import APPEARANCE_CACHE_WRITE from '../../../lib/service-clients/service-storage/graphql/entity-appearance-cache-write.graphql?raw';
import type { EntityData } from '../../entity/types/entity';
import { scheduledActionKeys } from '../../routines/queries/keys';
import {
  type EntityAppearance,
  supportsEntityAppearance,
} from '../core/appearance';

function patchRestReaders(
  queryClient: QueryClient,
  entity: EntityData,
  appearance: EntityAppearance
) {
  setPreviewAppearance(entity.id, appearance);
  if (entity.type === 'document') {
    queryClient.setQueryData<DocumentMetadata>(
      entityKeys.documentMetadata(entity.id).queryKey,
      (previous) => previous && { ...previous, appearance }
    );
  }
  if (entity.type === 'document' || entity.type === 'initiative') {
    const current = getSoupEntityById(entity.id);
    // This is a confirmed metadata patch, not a touch or a sort-key update.
    const data = { id: entity.id, appearance };
    hydrateSoupEntity({
      tag: entity.type,
      data,
      frecency_score: current?.frecency_score ?? 0,
    });
  }
  if (entity.type === 'routine') {
    queryClient.setQueryData<ScheduledAction>(
      scheduledActionKeys.detail({ scheduleId: entity.id }).queryKey,
      (previous) => previous && { ...previous, appearance }
    );
    queryClient.setQueryData<ScheduledAction[]>(
      scheduledActionKeys.list.queryKey,
      (previous) =>
        previous?.map((item) =>
          item.id === entity.id ? { ...item, appearance } : item
        )
    );
  }
  if (entity.type === 'database') {
    queryClient.setQueryData<DatabaseDetail>(
      databasesKeys.detail(entity.id).queryKey,
      (previous) =>
        previous && {
          ...previous,
          database: { ...previous.database, appearance },
        }
    );
    queryClient.setQueryData<ListedDatabase[]>(
      databasesKeys.list.queryKey,
      (previous) =>
        previous?.map((item) =>
          item.database.id === entity.id
            ? { ...item, database: { ...item.database, appearance } }
            : item
        )
    );
  }
  if (entity.type === 'form') {
    queryClient.setQueryData<FormDetail>(
      formsKeys.detail(entity.id).queryKey,
      (previous) =>
        previous && { ...previous, form: { ...previous.form, appearance } }
    );
    queryClient.setQueryData<ListedForm[]>(
      formsKeys.list.queryKey,
      (previous) =>
        previous?.map((item) =>
          item.form.id === entity.id
            ? { ...item, form: { ...item.form, appearance } }
            : item
        )
    );
    queryClient.setQueriesData<Form[]>(
      { queryKey: formsKeys.forDatabase._def },
      (previous) =>
        previous?.map((item) =>
          item.id === entity.id ? { ...item, appearance } : item
        )
    );
  }
}

export function createSaveEntityAppearance(sources: {
  queryClient: QueryClient;
  cacheHost: () => Pick<CacheHost, 'disabled' | 'writeQuery'> | undefined;
  update: (
    type: AppearanceEntityType,
    id: string,
    appearance: EntityAppearance
  ) => Promise<Result<unknown, unknown>>;
}) {
  return function saveEntityAppearance(
    entity: EntityData,
    appearance: EntityAppearance,
    isCurrent: () => boolean
  ): Promise<Result<void, string>> {
    const host = sources.cacheHost();
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
      const result = await sources.update(type, entity.id, appearance);
      if (result.isErr()) {
        span.error('appearance update failed');
        return err(t('appearance.saveFailed'));
      }
      if (!isCurrent()) return ok(undefined);

      // Reconciliation cannot turn a committed write into a retryable save failure.
      const updates = await Promise.allSettled([
        (async () => {
          patchRestReaders(sources.queryClient, entity, appearance);
        })(),
        host &&
        !host.disabled &&
        host === sources.cacheHost() &&
        (entity.type === 'document' || entity.type === 'initiative')
          ? host.writeQuery({
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
            })
          : Promise.resolve(),
      ]);
      if (updates.some((update) => update.status === 'rejected')) {
        Telemetry.warn('appearance cache reconciliation failed', {
          entity_type: entity.type,
        });
      }
      return ok(undefined);
    });
  };
}
