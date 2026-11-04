/**
 * The streamed sync's lanes, in load order (see "Load order" in
 * docs/architecture/streamed-cache-sync.md). Specs
 * and query text are built on use, never at module load. `../backfill` loads
 * this module only when it streams.
 */
import type { SyncLaneKind } from '@graphql-cache/sync-protocol';
import {
  CrmContactsDocument,
  type GraphqlCrmContactExpr,
  type GraphqlEntityFilterAst,
  SoupBackfillDocument,
  SoupMailBackfillDocument,
  SoupPropertyValueFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupInitialInput,
  graphqlSoupTransportDocument,
} from '@service-storage/graphql-soup';
import { type DocumentNode, getOperationAST, parse, print } from 'graphql';
import { match } from 'ts-pattern';
import {
  CORE_SOUP_BACKFILL_LANE,
  EMAIL_THREAD_PAGES_INPUT,
  INITIATIVE_SOUP_BACKFILL_LANE,
  SHARED_EMAIL_FILTER_BACKFILL_LANE,
  withEmailRecency,
} from '../backfill';
import {
  CHANNELS_SYNC,
  CONTACT_IDS_QUERY,
  CONTACTS_SYNC,
  channelSoupFilters,
  excludedSoupFilters,
  SYNCED_LIST_PAGE_SIZE,
  type SyncedList,
} from './lists';
import {
  SYNC_MINIMAL_DOCUMENT_FIELDS,
  TASK_PROJECT_SYNC_COVERAGE,
  TASK_PROJECTS_SYNC_LANE_ID,
  TASK_SYNC_COVERAGE,
  TASKS_SYNC_LANE_ID,
} from './minimal';

export type SyncPass = 'first' | 'second';

/**
 * Items per page. Streaming has no round trip per page, so lanes use Soup's
 * maximum; benchmarks compare sizes here.
 */
export const SYNC_PAGE_SIZES = {
  /** Every hydrate lane except email content. */
  hydrate: 500,
  /**
   * Threads with their first 20 messages. The stream's email-content budget
   * is 500 threads and 10,000 messages per page; 200 threads keep a page near
   * half a second of server time at L and XL (bench-data/results/server-fixes).
   */
  emailContent: 200,
  /** ID lists. */
  membership: 500,
  /** Calendar occurrences; matches the range reader's page. */
  calendar: 2_000,
} as const;

export const DOCUMENTS_RECENT_MAX_ITEMS = 1_000;
export const EMAIL_OLDER_MAX_ITEMS = 10_000;
const EMAIL_RECENT_DAYS = 60;
const EMAIL_OLDER_DAYS = 365;
const EMAIL_CONTENT_DAYS = 30;
export const CALENDAR_NEAR_MONTHS = 2;
export const CALENDAR_FAR_MONTHS = 12;
const EXCLUDED_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

export type SyncQuery = { query: string; operationName: string };

/** A Soup-paged lane before saved state picks its variables. */
export type SoupLaneSpec = {
  source: 'soup';
  id: string;
  query: () => SyncQuery;
  /** First-page input of a fresh pass started at `now` (ms). */
  input: (now: number) => GraphqlSoupInitialInput;
  kind: Extract<SyncLaneKind, { kind: 'hydrate' | 'membership' }>;
  /** A full fresh pass every run: never resumed, never narrowed to changes. */
  restartOnRun?: boolean;
  maxItems?: number;
  coverage?: unknown;
};

/** Calendar windows from the cache's range gaps, nearest month first. */
export type CalendarLaneSpec = {
  source: 'calendar';
  idPrefix: string;
  months: number;
};

export type SyncLaneSpec = SoupLaneSpec | CalendarLaneSpec;

/** Server-safe text (client-only directives removed) and its operation name. */
export function serverQuery(document: DocumentNode | string): SyncQuery {
  const query = graphqlSoupTransportDocument(
    typeof document === 'string' ? document : print(document)
  );
  const operationName = getOperationAST(parse(query))?.name?.value;
  if (!operationName)
    throw new Error('sync lane query needs a named operation');
  return { query, operationName };
}

/**
 * Minimal rows. `SoupBackfillSync…` names tell the cache to reject rows that
 * would be incomplete for local filtering.
 */
function minimalQuery(operationName: string): SyncQuery {
  return serverQuery(`query ${operationName}($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        ${SYNC_MINIMAL_DOCUMENT_FIELDS}
      }
      nextCursor
    }
  }
}
${print(SoupPropertyValueFieldsFragmentDoc)}`);
}

/** ID lists for membership lanes; their pages are never written. */
function idsQuery(operationName: string): SyncQuery {
  return serverQuery(`query ${operationName}($input: SoupInput!) {
  user { id soup(input: $input) { items { __typename id } nextCursor } }
}`);
}

/** The Task model's Soup scope. */
function taskFilters(): GraphqlEntityFilterAst {
  return {
    ...excludedSoupFilters(),
    documentFilter: { literal: { subType: 'TASK' } },
  };
}

/** Every task project the viewer can read. */
function taskProjectFilters(): GraphqlEntityFilterAst {
  return INITIATIVE_SOUP_BACKFILL_LANE.input.filters ?? {};
}

function documentFilters(): GraphqlEntityFilterAst {
  return {
    ...excludedSoupFilters(),
    documentFilter: { not: { literal: { subType: 'TASK' } } },
  };
}

/** Every thread shared with the viewer, outside the owned/delegated inboxes. */
function sharedEmailFilters(): GraphqlEntityFilterAst {
  return SHARED_EMAIL_FILTER_BACKFILL_LANE.input.filters ?? {};
}

/** `fetchCrmContacts`'s listing filter. */
const visibleContacts = (): GraphqlCrmContactExpr => ({
  and: {
    left: { literal: { hidden: false } },
    right: { literal: { include: true } },
  },
});

/** Core entities except documents and tasks (their own lanes), plus the CRM
 * companies and foreign entities the paged backfill's auxiliary lane covers. */
function coreRestFilters(): GraphqlEntityFilterAst {
  const filters: GraphqlEntityFilterAst =
    CORE_SOUP_BACKFILL_LANE.input.filters ?? {};
  const {
    crmCompanyFilter: _crmCompanyFilter,
    foreignEntityFilter: _foreignEntityFilter,
    ...core
  } = filters;
  return { ...core, documentFilter: { literal: { id: EXCLUDED_ENTITY_ID } } };
}

const HYDRATE = { kind: 'hydrate' } as const;

const rows =
  (
    filters: () => GraphqlEntityFilterAst,
    sortMethod: GraphqlSoupInitialInput['sortMethod'],
    limit: number = SYNC_PAGE_SIZES.hydrate
  ) =>
  (): GraphqlSoupInitialInput => ({
    limit,
    expand: true,
    sortMethod,
    emailView: 'ALL',
    filters: filters(),
  });

/** ID scans sort by creation, which never changes mid-scan, so a moving row
 * cannot be missed and then deleted. */
const ids = (filters: () => GraphqlEntityFilterAst) =>
  rows(filters, 'CREATED_AT', SYNC_PAGE_SIZES.membership);

const mailRows =
  (days: number, limit: number = SYNC_PAGE_SIZES.hydrate) =>
  (now: number): GraphqlSoupInitialInput =>
    withEmailRecency({ ...EMAIL_THREAD_PAGES_INPUT, limit }, [{ days }], now);

/**
 * A list the app reads whole from the cache (`lists.ts`). Re-listed in full
 * every run: neither list has a "changed since" filter, and joining a channel
 * or gaining a contact need not change a timestamp.
 */
function syncedListLane<Item>(list: SyncedList<Item>): SoupLaneSpec {
  return {
    source: 'soup',
    id: list.lane,
    query: () => serverQuery(list.query),
    input: () => list.initial() as GraphqlSoupInitialInput,
    kind: HYDRATE,
    restartOnRun: true,
    coverage: list.coverage,
  };
}

function firstPassLanes(): SyncLaneSpec[] {
  return [
    // Small, app-wide lists (mentions, sharing, compose, names) come first.
    syncedListLane(CONTACTS_SYNC),
    syncedListLane(CHANNELS_SYNC),
    {
      source: 'soup',
      id: TASKS_SYNC_LANE_ID,
      query: () => minimalQuery('SoupBackfillSyncTasks'),
      input: rows(taskFilters, 'UPDATED_AT'),
      kind: HYDRATE,
      coverage: TASK_SYNC_COVERAGE,
    },
    {
      // Project chips (`InitiativeIdentity`) answer from these records once
      // the lane completed with its coverage.
      source: 'soup',
      id: TASK_PROJECTS_SYNC_LANE_ID,
      query: () => serverQuery(SoupBackfillDocument),
      input: () => ({
        ...INITIATIVE_SOUP_BACKFILL_LANE.input,
        limit: SYNC_PAGE_SIZES.hydrate,
      }),
      kind: HYDRATE,
      coverage: TASK_PROJECT_SYNC_COVERAGE,
    },
    {
      source: 'soup',
      id: 'email-recent',
      query: () => serverQuery(SoupMailBackfillDocument),
      input: mailRows(EMAIL_RECENT_DAYS),
      kind: HYDRATE,
    },
    {
      // The paged backfill's Shared lane: both recency windows, refreshed in
      // full every run. `email-shared-ids` reconciles its scope.
      source: 'soup',
      id: 'email-shared',
      query: () => serverQuery(SoupMailBackfillDocument),
      input: (now) =>
        withEmailRecency(
          {
            ...SHARED_EMAIL_FILTER_BACKFILL_LANE.input,
            limit: SYNC_PAGE_SIZES.hydrate,
          },
          SHARED_EMAIL_FILTER_BACKFILL_LANE.emailRecency,
          now
        ),
      kind: HYDRATE,
      restartOnRun: true,
    },
    {
      source: 'soup',
      id: 'documents-recent',
      query: () => minimalQuery('SoupBackfillSyncDocuments'),
      input: rows(documentFilters, 'VIEWED_UPDATED'),
      kind: HYDRATE,
      maxItems: DOCUMENTS_RECENT_MAX_ITEMS,
    },
    {
      source: 'calendar',
      idPrefix: 'calendar-near',
      months: CALENDAR_NEAR_MONTHS,
    },
    {
      source: 'soup',
      id: 'tasks-ids',
      query: () => idsQuery('SoupSyncTaskIds'),
      input: ids(taskFilters),
      kind: { kind: 'membership', scopes: [TASKS_SYNC_LANE_ID] },
    },
    {
      // A project deleted or no longer shared leaves the cache, so a chip
      // answered from it cannot outlive the viewer's access.
      source: 'soup',
      id: 'task-projects-ids',
      query: () => idsQuery('SoupSyncTaskProjectIds'),
      input: ids(taskProjectFilters),
      kind: { kind: 'membership', scopes: [TASK_PROJECTS_SYNC_LANE_ID] },
    },
    {
      source: 'soup',
      id: 'contacts-ids',
      query: () => serverQuery(CONTACT_IDS_QUERY),
      input: () =>
        ({ limit: SYNCED_LIST_PAGE_SIZE }) as GraphqlSoupInitialInput,
      kind: { kind: 'membership', scopes: [CONTACTS_SYNC.lane] },
    },
    {
      source: 'soup',
      id: 'channels-ids',
      query: () => idsQuery('SoupSyncChannelIds'),
      input: ids(channelSoupFilters),
      kind: { kind: 'membership', scopes: [CHANNELS_SYNC.lane] },
    },
    {
      source: 'soup',
      id: 'documents-ids',
      query: () => idsQuery('SoupSyncDocumentIds'),
      input: ids(documentFilters),
      kind: {
        kind: 'membership',
        scopes: ['documents-recent', 'documents-rest'],
      },
    },
    {
      // Every shared thread, not only the windows: a delivered thread is
      // deleted only once it is no longer shared with the viewer.
      source: 'soup',
      id: 'email-shared-ids',
      query: () => idsQuery('SoupSyncSharedEmailIds'),
      input: ids(sharedEmailFilters),
      kind: { kind: 'membership', scopes: ['email-shared'] },
    },
  ];
}

function secondPassLanes(): SyncLaneSpec[] {
  return [
    {
      source: 'soup',
      id: 'crm-contacts',
      query: () => serverQuery(CrmContactsDocument),
      input: () => ({
        limit: SYNC_PAGE_SIZES.hydrate,
        sortMethod: 'UPDATED_AT',
        filters: {
          ...excludedSoupFilters(),
          crmContactFilter: visibleContacts(),
        },
      }),
      kind: HYDRATE,
    },
    {
      source: 'soup',
      id: 'core-rest',
      query: () => serverQuery(SoupBackfillDocument),
      input: () => ({
        ...CORE_SOUP_BACKFILL_LANE.input,
        limit: SYNC_PAGE_SIZES.hydrate,
        filters: coreRestFilters(),
      }),
      kind: HYDRATE,
    },
    {
      source: 'soup',
      id: 'documents-rest',
      query: () => minimalQuery('SoupBackfillSyncDocuments'),
      input: rows(documentFilters, 'VIEWED_UPDATED'),
      kind: HYDRATE,
      coverage: { entity: 'document', scope: 'all' },
    },
    {
      source: 'calendar',
      idPrefix: 'calendar-far',
      months: CALENDAR_FAR_MONTHS,
    },
    {
      source: 'soup',
      id: 'email-older',
      query: () => serverQuery(SoupMailBackfillDocument),
      input: mailRows(EMAIL_OLDER_DAYS),
      kind: HYDRATE,
      maxItems: EMAIL_OLDER_MAX_ITEMS,
    },
    {
      source: 'soup',
      id: 'tasks-details',
      query: () => serverQuery(SoupBackfillDocument),
      input: rows(taskFilters, 'UPDATED_AT'),
      kind: HYDRATE,
    },
    {
      source: 'soup',
      id: 'documents-details',
      query: () => serverQuery(SoupBackfillDocument),
      input: rows(documentFilters, 'VIEWED_UPDATED'),
      kind: HYDRATE,
      maxItems: DOCUMENTS_RECENT_MAX_ITEMS,
    },
    {
      source: 'soup',
      id: 'email-content',
      query: () => serverQuery(SoupBackfillDocument),
      input: mailRows(EMAIL_CONTENT_DAYS, SYNC_PAGE_SIZES.emailContent),
      kind: HYDRATE,
    },
  ];
}

export function syncLaneSpecs(pass: SyncPass): SyncLaneSpec[] {
  return match(pass)
    .with('first', firstPassLanes)
    .with('second', secondPassLanes)
    .exhaustive((): SyncLaneSpec[] => []);
}
