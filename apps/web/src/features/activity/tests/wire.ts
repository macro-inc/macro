import type {
  ActivityEventFieldsFragment,
  EntityActivityQuery,
  MyActivityOverviewQuery,
  MyActivityQuery,
} from '@service-storage/graphql/generated/graphql';

/** One MyActivity page as the server returns it. */
export function feedPage(
  items: ActivityEventFieldsFragment[],
  nextCursor: string | null = null
): MyActivityQuery {
  return { user: { id: 'user-1', activity: { nextCursor, items } } };
}

export function overviewPage(
  overrides: Partial<MyActivityOverviewQuery['user']['activityOverview']> = {}
): MyActivityOverviewQuery {
  return {
    user: {
      id: 'user-1',
      activityOverview: {
        from: '2025-09-01',
        to: '2026-09-01',
        timeZone: 'UTC',
        total: 0,
        days: [],
        topEntities: [],
        ...overrides,
      },
    },
  };
}

export function soupPage(
  items: EntityActivityQuery['user']['soup']['items']
): EntityActivityQuery {
  return { user: { id: 'user-1', soup: { items } } };
}
