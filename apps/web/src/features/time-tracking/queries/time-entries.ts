import { SYSTEM_PROPERTY_IDS } from '@app/features/property/identifiers';
import type { OptimisticResponse } from '@graphql-cache/exchange/optimistic';
import {
  type CacheHost,
  executeOptimisticMutation,
  type OptimisticUpdate,
  prependUnique,
  readRecordsByKeys,
  remove,
  selectRecord,
  selectRecords,
  update,
} from '@graphql-cache/index';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  DeleteTimeEntryDocument,
  type DeleteTimeEntryMutation,
  LogTimeDocument,
  type LogTimeMutation,
  type SoupEntityInput,
  type SoupPropertyFieldsFragment,
  TaskTimeEntriesAfterDocument,
  type TaskTimeEntriesAfterQuery,
  TaskTimeEntriesDocument,
  type TaskTimeEntriesQuery,
  type TimeEntriesParentFragment,
  TimeEntriesParentFragmentDoc,
  type TimeEntryFieldsFragment,
  type TimeEntryPageFieldsFragment,
  type TimeLoggedTaskPropertiesFragment,
  TimeLoggedTaskPropertiesFragmentDoc,
  UpdateTimeEntryDocument,
  type UpdateTimeEntryMutation,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import { type TimeWriteResult, timeWriteResult } from './write-result';

const TASK_TYPENAME = 'GraphqlSoupDocument';
const ENTRY_TYPENAME = 'GraphqlTimeEntry';

/** Namespace of the queue keys that let a newer edit of an entry replace an older one. */
const ENTRY_EDIT_UUID_NAMESPACE = '4d0c1f0a-5a3e-4f4e-9a7c-6b2e8f1d3c90';

/** Where the cache reads a task's Time logged before a write predicts it. */
export type TimeLoggedHost = Pick<CacheHost, 'readRecordsByKeys'>;

/** Values a person types for an entry. Dates are `YYYY-MM-DD`, instants ISO strings. */
export type TimeEntryValues = {
  date: string;
  minutes: number;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

function taskInput(taskId: string): SoupEntityInput {
  return { entityType: 'DOCUMENT', entityId: taskId };
}

function pageOf(
  data: TaskTimeEntriesQuery | TaskTimeEntriesAfterQuery
): TimeEntryPageFieldsFragment | undefined {
  const entity = data.user.soupEntity;
  return entity?.__typename === TASK_TYPENAME ? entity.timeEntries : undefined;
}

/**
 * A task's first page of time entries, newest day first, read through the
 * GraphQL cache and refreshed from the server when it mounts. Writes update
 * it in place: an optimistic entry first, then the server's page.
 */
export function createTaskTimeEntriesQuery(
  taskId: Accessor<string | undefined>,
  client: () => Client = getGraphqlSoupClient
) {
  const query = createLiveQuery(
    TaskTimeEntriesDocument,
    () => {
      const id = taskId();
      return id ? { input: taskInput(id) } : undefined;
    },
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      select: pageOf,
    })
  );
  return {
    entries: (): readonly TimeEntryFieldsFragment[] =>
      query.isSuccess ? (query.data?.entries ?? []) : [],
    nextCursor: (): string | undefined =>
      query.isSuccess ? (query.data?.nextCursor ?? undefined) : undefined,
    /** No answer yet, so an empty list cannot say the task has no time. */
    pending: () => query.isPending,
    failed: () => !query.isSuccess && query.isError,
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

/** The page of a task's entries after `after`, a cursor a page returned. */
export function createTaskTimeEntriesAfterQuery(
  taskId: Accessor<string | undefined>,
  after: Accessor<string | undefined>,
  client: () => Client = getGraphqlSoupClient
) {
  const query = createLiveQuery(
    TaskTimeEntriesAfterDocument,
    () => {
      const id = taskId();
      const cursor = after();
      return id && cursor ? { input: taskInput(id), after: cursor } : undefined;
    },
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      select: pageOf,
    })
  );
  return {
    entries: (): readonly TimeEntryFieldsFragment[] =>
      query.isSuccess ? (query.data?.entries ?? []) : [],
    nextCursor: (): string | undefined =>
      query.isSuccess ? (query.data?.nextCursor ?? undefined) : undefined,
    pending: () => query.isPending,
  };
}

/** The task's first page of entries, as a link-patch target. */
function entriesOf(taskId: string) {
  return selectRecord(TimeEntriesParentFragmentDoc, {
    __typename: TASK_TYPENAME,
    id: taskId,
  })
    .field('timeEntries')
    .field('entries');
}

function minutesOf(property: SoupPropertyFieldsFragment): number {
  return property.value?.__typename === 'GraphqlNumberPropertyValue'
    ? property.value.numberValue
    : 0;
}

function timeLoggedRecord(
  taskId: string,
  minutes: number,
  existing: SoupPropertyFieldsFragment | undefined
): SoupPropertyFieldsFragment {
  return {
    id:
      existing?.id ??
      `optimistic-property:DOCUMENT:${taskId}:${SYSTEM_PROPERTY_IDS.TIME_LOGGED}`,
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.TIME_LOGGED,
    displayName: existing?.displayName ?? 'Time logged',
    dataType: 'NUMBER',
    isMultiSelect: false,
    specificEntityType: null,
    isSystem: true,
    isMetadata: existing?.isMetadata ?? false,
    value: { __typename: 'GraphqlNumberPropertyValue', numberValue: minutes },
  };
}

/**
 * The task's properties with Time logged moved by `deltaMinutes`, or
 * undefined when the cache does not hold them: the reply then brings the
 * total. A task that has logged nothing gains the property under a
 * task-scoped temporary id, which the reply's own list replaces.
 */
export function withTimeLoggedChange(
  task: TimeLoggedTaskPropertiesFragment | undefined,
  deltaMinutes: number
): SoupPropertyFieldsFragment[] | undefined {
  if (!task) return undefined;
  const existing = task.properties.find(
    (property) =>
      property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.TIME_LOGGED
  );
  const total = Math.max(
    0,
    (existing ? minutesOf(existing) : 0) + deltaMinutes
  );
  const record = timeLoggedRecord(task.id, total, existing);
  return existing
    ? task.properties.map((property) =>
        property.id === existing.id ? record : property
      )
    : [...task.properties, record];
}

/** What the cache holds of a task when a write predicts its outcome. */
export type CachedTimeTask = {
  /** The task's properties; absent when the task is not cached. */
  task: TimeLoggedTaskPropertiesFragment | undefined;
  /** Whether its first page of entries is cached, so a link patch can reach it. */
  pageCached: boolean;
};

async function readCached<T>(
  host: TimeLoggedHost,
  selection: Parameters<typeof readRecordsByKeys<T>>[1],
  taskId: string
): Promise<T | undefined> {
  try {
    const { records } = await readRecordsByKeys<T>(host, selection, [
      `${TASK_TYPENAME}:${taskId}`,
    ]);
    return records[0]?.record;
  } catch (error) {
    console.warn('Time tracking prediction read failed', error);
    return undefined;
  }
}

/**
 * Read what a time write's prediction builds on. A record-rooted link patch
 * whose page is not cached would fail the whole enqueue, so callers patch the
 * list only when `pageCached`; the reply's page fills it otherwise.
 */
export async function readCachedTimeTask(
  host: TimeLoggedHost | undefined,
  taskId: string
): Promise<CachedTimeTask> {
  if (!host) return { task: undefined, pageCached: false };
  const [task, page] = await Promise.all([
    readCached<TimeLoggedTaskPropertiesFragment>(
      host,
      selectRecords(TimeLoggedTaskPropertiesFragmentDoc),
      taskId
    ),
    readCached<TimeEntriesParentFragment>(
      host,
      selectRecords(TimeEntriesParentFragmentDoc),
      taskId
    ),
  ]);
  return { task, pageCached: page !== undefined };
}

/**
 * The task as a write predicts it: its Time logged moved by `deltaMinutes`.
 * Undefined when the task is not cached; the reply then brings it.
 */
export function optimisticTask(cached: CachedTimeTask, deltaMinutes: number) {
  const properties = withTimeLoggedChange(cached.task, deltaMinutes);
  return properties && cached.task
    ? ({ __typename: TASK_TYPENAME, id: cached.task.id, properties } as const)
    : undefined;
}

/** The reply's `task`, left out when nothing is predicted about it. */
function withTask(task: ReturnType<typeof optimisticTask>) {
  return task ? { task } : {};
}

/** A new entry exactly as the server will return it to its author. */
export function optimisticEntry(args: {
  id: string;
  taskId: string;
  userId: string;
  values: TimeEntryValues;
  now: string;
}): TimeEntryFieldsFragment {
  return {
    id: args.id,
    taskId: args.taskId,
    userId: args.userId,
    ...args.values,
    source: 'MANUAL',
    createdAt: args.now,
    updatedAt: args.now,
    canEdit: true,
  };
}

/** The link patches that put a new entry at the top of its task's cached page. */
export function logTimeUpdates(
  cached: CachedTimeTask,
  taskId: string,
  entryId: string
): OptimisticUpdate[] {
  if (!cached.pageCached) return [];
  return [
    update(
      entriesOf(taskId),
      prependUnique({ __typename: ENTRY_TYPENAME, id: entryId })
    ),
  ];
}

/** The link patches that take an entry off its task's cached page. */
export function deleteTimeEntryUpdates(
  cached: CachedTimeTask,
  taskId: string,
  entryId: string
): OptimisticUpdate[] {
  if (!cached.pageCached) return [];
  return [
    update(
      entriesOf(taskId),
      remove({ __typename: ENTRY_TYPENAME, id: entryId })
    ),
  ];
}

/** Queue key of an entry's edit: a newer edit of the same entry replaces an older queued one. */
export function timeEntryEditUuid(entryId: string): string {
  return uuidv5(
    JSON.stringify(['updateTimeEntry', entryId]),
    ENTRY_EDIT_UUID_NAMESPACE
  );
}

type WriteDependencies = {
  client?: Client;
  host?: TimeLoggedHost;
  now?: () => Date;
};

/**
 * Log typed time on a task. The entry and the task's new Time logged show at
 * once; offline, the write waits in the durable queue and survives a reload.
 * The entry's id is chosen here and sent, so a replay logs it once.
 */
export async function logTime(
  args: {
    taskId: string;
    userId: string;
    values: TimeEntryValues;
    id?: string;
  },
  dependencies: WriteDependencies = {}
): Promise<TimeWriteResult> {
  const client = dependencies.client ?? getGraphqlSoupClient();
  const host = dependencies.host ?? getGraphqlCacheHost();
  const id = args.id ?? uuidv7();
  const now = (dependencies.now?.() ?? new Date()).toISOString();
  const cached = await readCachedTimeTask(host, args.taskId);
  const optimisticData: OptimisticResponse<LogTimeMutation> = {
    logTime: {
      entry: optimisticEntry({
        id,
        taskId: args.taskId,
        userId: args.userId,
        values: args.values,
        now,
      }),
      ...withTask(optimisticTask(cached, args.values.minutes)),
    },
  };
  const result = await executeOptimisticMutation(
    client,
    LogTimeDocument,
    { input: { id, taskId: args.taskId, ...args.values } },
    optimisticData,
    { uuid: id, updates: logTimeUpdates(cached, args.taskId, id) }
  ).toPromise();
  return timeWriteResult(result);
}

/**
 * Change one's own entry to `values`. The whole entry is sent, so a newer
 * queued edit of it can replace an older one.
 */
export async function updateTimeEntry(
  args: { entry: TimeEntryFieldsFragment; values: TimeEntryValues },
  dependencies: WriteDependencies = {}
): Promise<TimeWriteResult> {
  const client = dependencies.client ?? getGraphqlSoupClient();
  const host = dependencies.host ?? getGraphqlCacheHost();
  const { entry, values } = args;
  const now = (dependencies.now?.() ?? new Date()).toISOString();
  const cached = await readCachedTimeTask(host, entry.taskId);
  const optimisticData: OptimisticResponse<UpdateTimeEntryMutation> = {
    updateTimeEntry: {
      entry: { ...entry, ...values, updatedAt: now },
      ...withTask(optimisticTask(cached, values.minutes - entry.minutes)),
    },
  };
  const result = await executeOptimisticMutation(
    client,
    UpdateTimeEntryDocument,
    { input: { id: entry.id, ...values } },
    optimisticData,
    { uuid: timeEntryEditUuid(entry.id) }
  ).toPromise();
  return timeWriteResult(result);
}

/** Delete one's own entry; it leaves the list and the total at once. */
export async function deleteTimeEntry(
  args: { entry: TimeEntryFieldsFragment },
  dependencies: WriteDependencies = {}
): Promise<TimeWriteResult> {
  const client = dependencies.client ?? getGraphqlSoupClient();
  const host = dependencies.host ?? getGraphqlCacheHost();
  const { entry } = args;
  const cached = await readCachedTimeTask(host, entry.taskId);
  const optimisticData: OptimisticResponse<DeleteTimeEntryMutation> = {
    deleteTimeEntry: {
      deletedEntryId: entry.id,
      ...withTask(optimisticTask(cached, -entry.minutes)),
    },
  };
  const result = await executeOptimisticMutation(
    client,
    DeleteTimeEntryDocument,
    { input: { id: entry.id, taskId: entry.taskId } },
    optimisticData,
    {
      uuid: crypto.randomUUID(),
      updates: deleteTimeEntryUpdates(cached, entry.taskId, entry.id),
    }
  ).toPromise();
  return timeWriteResult(result);
}
