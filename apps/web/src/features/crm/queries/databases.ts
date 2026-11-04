import { fireAndForget } from '@core/util/fireAndForget';
import type { DatabaseEntity } from '@entity';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import type {
  createSoupLiveQuery,
  SoupLiveQueryInput,
} from '@queries/soup/graphql/create-soup-live-query';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import type {
  onDatabaseBatchCommitted,
  onDatabaseTableAdvanced,
  useDatabasesQuery,
} from '@queries/storage/databases';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { Accessor } from 'solid-js';
import { createMemo, onCleanup } from 'solid-js';
import { NIL as NIL_UUID } from 'uuid';
import type { ItemListSource } from '../context/crm-sources';
import type { CrmRecordScope } from '../core/record';
import { crmAssociation } from './record-items';

/** Opt into database rows while excluding every other Soup source. */
export function crmDatabasesInput(
  scope?: CrmRecordScope
): SoupLiveQueryInput | undefined {
  const input = buildGraphqlEntitySoupInput('DATABASE_ROW', NIL_UUID)?.initial;
  if (!input) return undefined;
  return {
    ...input,
    limit: 100,
    filters: {
      ...input.filters,
      databaseRowFilter: { literal: { include: true } },
      crmAssociation: scope ? crmAssociation(scope) : { activity: true },
    },
  };
}

/** A database appears once, only after an authorized associated row names it. */
export function selectCrmDatabases(
  rows: readonly { databaseId: string }[],
  listed: readonly ListedDatabase[]
): DatabaseEntity[] {
  const databases = new Map(listed.map((entry) => [entry.database.id, entry]));
  return [...new Set(rows.map((row) => row.databaseId))].flatMap((id) => {
    const entry = databases.get(id);
    if (!entry || entry.database.trashed_at) return [];
    return [
      {
        type: 'database',
        id,
        name: entry.database.name,
        ownerId: entry.database.owner_id,
        createdAt: entry.database.created_at,
        grant: entry.grant,
      },
    ];
  });
}

/** Reuse Soup's authorization, cursor chain, and CRM-link invalidation. */
export function createCrmDatabasesSource(
  sources: {
    createRows: typeof createSoupLiveQuery;
    createListing: typeof useDatabasesQuery;
    onCommitted: typeof onDatabaseBatchCommitted;
    onTableAdvanced: typeof onDatabaseTableAdvanced;
  },
  scope: Accessor<CrmRecordScope | undefined>,
  enabled: Accessor<boolean>
): ItemListSource {
  const rows = sources.createRows(
    () => crmDatabasesInput(scope()),
    () => ({
      enabled: enabled(),
      keepPreviousData: false,
    })
  );
  const listing = sources.createListing();
  const refresh = async () => {
    await Promise.all([
      rows.refresh(),
      listing.refetch({ throwOnError: true }),
    ]);
  };
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: enabled,
      body: () => {
        const current = scope();
        return { crma: current ? crmAssociation(current) : 'activity' };
      },
      refresh,
    })
  );
  const refreshAfterWrite = () => {
    if (enabled()) fireAndForget(refresh(), 'crm');
  };
  onCleanup(sources.onCommitted(refreshAfterWrite));
  onCleanup(sources.onTableAdvanced(refreshAfterWrite));
  const data = createMemo(() => {
    const items = rows.data();
    if (listing.isPending || !items) return undefined;
    return {
      entities: selectCrmDatabases(
        items.flatMap((item) =>
          item.__typename === 'GraphqlSoupDatabaseRow' ? [item] : []
        ),
        listing.data ?? []
      ),
    };
  });
  return {
    get data() {
      return data();
    },
    get isPending() {
      return !listing.isError && !rows.error() && data() === undefined;
    },
    get isEnabled() {
      return enabled();
    },
    get isLoading() {
      return rows.isLoading() || listing.isLoading;
    },
    get isError() {
      return (
        listing.isError || (!!rows.error() && !rows.isFetchNextPageError())
      );
    },
    get isFetchNextPageError() {
      return rows.isFetchNextPageError();
    },
    get hasNextPage() {
      return rows.hasNextPage();
    },
    get isFetchingNextPage() {
      return rows.isFetchingNextPage();
    },
    fetchNextPage: () => rows.fetchNextPage(),
    refetch: refresh,
  };
}
