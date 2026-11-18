import { setPreviewAppearance } from '@queries/preview';
import {
  getSoupEntityById,
  hydrateSoupEntity,
  optimisticUpdateSoupEntity,
} from '@queries/soup/cache';
import { databasesKeys, entityKeys, formsKeys } from '@queries/storage/keys';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas/scheduledAction';
import type { AppearanceEntityType as ApiEntityType } from '@service-storage/entity-appearance';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import type { QueryClient, QueryKey } from '@tanstack/solid-query';
import { scheduledActionKeys } from '../../routines/queries/keys';
import {
  type AppearanceEntityType,
  type EntityAppearance,
  sameAppearance,
} from '../core/appearance';

type Rollback = () => void;
type Reader = {
  key: QueryKey;
  patch: (appearance: EntityAppearance) => Rollback;
};
export type SoupAppearanceTarget = {
  tag: 'document' | 'initiative';
  typename: 'GraphqlSoupDocument' | 'GraphqlSoupInitiative';
};
type Adapter = {
  apiType: ApiEntityType;
  soup?: SoupAppearanceTarget;
  readers: Reader[];
};

/** One entity dispatch owns both cache readers and their cancellation keys. */
export function appearanceAdapter(
  queryClient: QueryClient,
  type: AppearanceEntityType,
  id: string
): Adapter {
  function reader<T>(
    key: QueryKey,
    read: (value: T) => EntityAppearance | null | undefined,
    write: (value: T, next: EntityAppearance | null | undefined) => T,
    exact = true
  ): Reader {
    return {
      key,
      patch(appearance) {
        const rollbacks: Rollback[] = [];
        for (const [queryKey, previous] of queryClient.getQueriesData<T>({
          queryKey: key,
          exact,
        })) {
          if (previous === undefined) continue;
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
        return () => {
          for (const rollback of rollbacks.reverse()) rollback();
        };
      },
    };
  }
  const adapters: Record<AppearanceEntityType, () => Adapter> = {
    document: () => ({
      apiType: 'document',
      soup: { tag: 'document', typename: 'GraphqlSoupDocument' },
      readers: [
        reader<DocumentMetadata>(
          entityKeys.documentMetadata(id).queryKey,
          (value) => value.appearance,
          (value, next) => ({ ...value, appearance: next ?? null })
        ),
      ],
    }),
    initiative: () => ({
      apiType: 'initiative',
      soup: { tag: 'initiative', typename: 'GraphqlSoupInitiative' },
      readers: [],
    }),
    routine: () => ({
      apiType: 'scheduled_action',
      readers: [
        reader<ScheduledAction>(
          scheduledActionKeys.detail({ scheduleId: id }).queryKey,
          (value) => value.appearance,
          (value, next) => ({ ...value, appearance: next ?? undefined })
        ),
        reader<ScheduledAction[]>(
          scheduledActionKeys.list.queryKey,
          (value) => value.find((item) => item.id === id)?.appearance,
          (value, next) =>
            value.map((item) =>
              item.id === id ? { ...item, appearance: next ?? undefined } : item
            )
        ),
      ],
    }),
    database: () => ({
      apiType: 'database',
      readers: [
        reader<DatabaseDetail>(
          databasesKeys.detail(id).queryKey,
          (value) => value.database.appearance,
          (value, next) => ({
            ...value,
            database: { ...value.database, appearance: next ?? null },
          })
        ),
        reader<ListedDatabase[]>(
          databasesKeys.list.queryKey,
          (value) =>
            value.find((item) => item.database.id === id)?.database.appearance,
          (value, next) =>
            value.map((item) =>
              item.database.id === id
                ? {
                    ...item,
                    database: { ...item.database, appearance: next ?? null },
                  }
                : item
            )
        ),
      ],
    }),
    form: () => ({
      apiType: 'form',
      readers: [
        reader<FormDetail>(
          formsKeys.detail(id).queryKey,
          (value) => value.form.appearance,
          (value, next) => ({
            ...value,
            form: { ...value.form, appearance: next ?? null },
          })
        ),
        reader<ListedForm[]>(
          formsKeys.list.queryKey,
          (value) => value.find((item) => item.form.id === id)?.form.appearance,
          (value, next) =>
            value.map((item) =>
              item.form.id === id
                ? { ...item, form: { ...item.form, appearance: next ?? null } }
                : item
            )
        ),
        reader<Form[]>(
          formsKeys.forDatabase._def,
          (value) => value.find((item) => item.id === id)?.appearance,
          (value, next) =>
            value.map((item) =>
              item.id === id ? { ...item, appearance: next ?? null } : item
            ),
          false
        ),
      ],
    }),
  };
  return adapters[type]();
}

export function patchAppearanceReaders(
  adapter: Adapter,
  id: string,
  appearance: EntityAppearance
): Rollback {
  const rollbacks = adapter.readers.map((reader) => reader.patch(appearance));
  const previewBefore = setPreviewAppearance(id, appearance);
  if (previewBefore !== undefined) {
    rollbacks.push(() => {
      setPreviewAppearance(id, previewBefore.appearance, appearance);
    });
  }
  const soup = adapter.soup;
  const current = soup && getSoupEntityById(id);
  if (
    soup &&
    current &&
    (current.tag === 'document' || current.tag === 'initiative')
  ) {
    const previous = current.data.appearance;
    optimisticUpdateSoupEntity({
      tag: soup.tag,
      data: { id, appearance },
      frecency_score: current.frecency_score,
    });
    rollbacks.push(() => {
      const latest = getSoupEntityById(id);
      if (
        latest &&
        (latest.tag === 'document' || latest.tag === 'initiative') &&
        sameAppearance(latest.data.appearance, appearance)
      ) {
        hydrateSoupEntity({
          tag: soup.tag,
          data: { id, appearance: previous ?? null },
          frecency_score: latest.frecency_score,
        });
      }
    });
  }
  return () => {
    for (const rollback of rollbacks.reverse()) rollback();
  };
}
