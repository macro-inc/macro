import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ColumnCast as ServerColumnCast } from '@service-storage/generated/schemas/columnCast';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  DatabaseColumnCast,
  DatabaseColumnCasts,
  DatabaseColumnCastsSource,
} from '../core/column-schema';
import { databaseColumnKeys } from './keys';

/** The type menu's dry runs for one table, fetched when a menu opens. */
export function createColumnCasts(params: {
  databaseId: string;
  tableId: string;
  version: Accessor<number>;
}): DatabaseColumnCastsSource {
  return (columnId, open) => {
    const query = useQuery(() => {
      const version = params.version();
      return {
        queryKey: databaseColumnKeys.casts(
          params.databaseId,
          params.tableId,
          columnId,
          version
        ).queryKey,
        queryFn: () =>
          throwOnErr(() =>
            storageServiceClient.databases.columnCasts({
              id: params.databaseId,
              tableId: params.tableId,
              columnId,
            })
          ),
        enabled: open(),
        select: (casts: ServerColumnCast[]) => ({
          version,
          casts: casts.map(toMenuCast),
        }),
      };
    });
    // Gated on status: an unopened menu's query is pending and must not suspend.
    return (): DatabaseColumnCasts =>
      query.isSuccess
        ? { status: 'ready', ...query.data }
        : query.isError
          ? { status: 'error' }
          : { status: 'loading' };
  };
}

function toMenuCast(cast: ServerColumnCast) {
  return {
    target: {
      dataType: cast.data_type,
      isMultiSelect: cast.is_multi_select,
      specificEntityType: cast.specific_entity_type ?? undefined,
      relation: cast.relation,
    },
    cast: match(cast.cast)
      .returnType<DatabaseColumnCast>()
      .with('safe', () => ({ verdict: 'safe' }))
      .with('checked', () => ({
        verdict: 'checked',
        failures: cast.failures,
        summary: cast.summary ?? undefined,
        examples: cast.examples,
      }))
      .with('never', () => ({ verdict: 'never', reason: cast.reason ?? '' }))
      .exhaustive(),
  };
}
