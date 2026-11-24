import { SYSTEM_PROPERTY_IDS } from '@app/features/property/identifiers';
import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type {
  DeleteTimeEntryMutation,
  LogTimeMutation,
  SoupPropertyFieldsFragment,
  TimeEntryFieldsFragment,
  UpdateTimeEntryMutation,
} from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { map, pipe } from 'wonka';
import {
  deleteTimeEntry,
  logTime,
  type TimeLoggedHost,
  timeEntryEditUuid,
  updateTimeEntry,
  withTimeLoggedChange,
} from './time-entries';

const TASK = '0196a000-0000-7000-8000-0000000000a1';
const ENTRY = '0196a000-0000-7000-8000-000000000001';
const AUTHOR = 'macro|author@example.com';
const NOW = new Date('2026-11-20T12:00:00.000Z');

const priority: SoupPropertyFieldsFragment = {
  id: 'priority-1',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
  displayName: 'Priority',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  specificEntityType: null,
  isSystem: true,
  isMetadata: false,
  value: {
    __typename: 'GraphqlSelectOptionPropertyValue',
    optionIds: ['high'],
  },
};

function timeLogged(minutes: number): SoupPropertyFieldsFragment {
  return {
    id: 'time-logged-1',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.TIME_LOGGED,
    displayName: 'Time logged',
    dataType: 'NUMBER',
    isMultiSelect: false,
    specificEntityType: null,
    isSystem: true,
    isMetadata: false,
    value: { __typename: 'GraphqlNumberPropertyValue', numberValue: minutes },
  };
}

const values = {
  date: '2026-11-20',
  minutes: 30,
  note: 'Review',
  startedAt: null,
  endedAt: null,
};

const entry: TimeEntryFieldsFragment = {
  id: ENTRY,
  taskId: TASK,
  userId: AUTHOR,
  date: '2026-11-19',
  minutes: 45,
  note: null,
  startedAt: null,
  endedAt: null,
  source: 'MANUAL',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  canEdit: true,
};

/** A cache holding the task's properties and, when `page`, its first page of entries. */
function host(
  properties: SoupPropertyFieldsFragment[] | undefined,
  page: boolean,
  firstDay?: string
): TimeLoggedHost {
  return {
    async readRecordsByKeys({ fragmentName, keys }) {
      const held =
        fragmentName === 'TimeLoggedTaskProperties'
          ? properties && {
              __typename: 'GraphqlSoupDocument',
              id: TASK,
              properties,
            }
          : page && {
              __typename: 'GraphqlSoupDocument',
              id: TASK,
              timeEntries: {
                entries: firstDay ? [{ id: 'older', date: firstDay }] : [],
              },
            };
      return {
        revision: parseCacheRevision('1'),
        records: held ? [{ recordKey: keys[0], record: held }] : [],
      };
    },
  };
}

/** A client whose writes all wait in the offline queue, recording what it was sent. */
function queuedClient() {
  const operations: Operation[] = [];
  const client = createClient({
    url: 'http://example.test/graphql',
    exchanges: [
      () => (source) =>
        pipe(
          source,
          map((operation) => {
            operations.push(operation);
            return {
              operation,
              stale: false,
              hasNext: false,
              extensions: {
                normalizedCacheMutationDisposition: {
                  kind: 'queued',
                  transactionId: 'queued',
                },
              },
            };
          })
        ),
    ],
  });
  return { client, operations };
}

function sent(operations: Operation[]) {
  const [operation] = operations;
  const optimistic = optimisticContextOf(operation);
  if (!optimistic || !operation.variables) {
    throw new Error('the write must be optimistic, with variables');
  }
  return { variables: operation.variables, optimistic };
}

describe('logTime', () => {
  it('shows the entry on its cached page and moves Time logged at once', async () => {
    const { client, operations } = queuedClient();
    const result = await logTime(
      { taskId: TASK, userId: AUTHOR, values, id: ENTRY },
      { client, host: host([priority, timeLogged(90)], true), now: () => NOW }
    );
    expect(result._unsafeUnwrap()).toEqual({ kind: 'queued' });

    const { variables, optimistic } = sent(operations);
    expect(variables).toEqual({
      input: { id: ENTRY, taskId: TASK, ...values },
    });
    expect(optimistic.uuid).toBe(ENTRY);
    const response = optimistic.optimisticResponse as LogTimeMutation;
    expect(response.logTime.entry).toEqual({
      ...entry,
      ...values,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(response.logTime.task?.properties).toEqual([
      priority,
      timeLogged(120),
    ]);
    expect(optimistic.linkPatches).toHaveLength(1);
    expect(optimistic.linkPatches[0]).toMatchObject({
      recordRoot: {
        fragmentName: 'TimeEntriesParent',
        entityKey: `GraphqlSoupDocument:${TASK}`,
      },
      path: [{ field: 'timeEntries' }, { field: 'entries' }],
      operation: {
        kind: 'prependUnique',
        entityKey: `GraphqlTimeEntry:${ENTRY}`,
      },
    });
  });

  it('leaves the list to the reply when the page was never read', async () => {
    const { client, operations } = queuedClient();
    await logTime(
      { taskId: TASK, userId: AUTHOR, values, id: ENTRY },
      { client, host: host([timeLogged(90)], false), now: () => NOW }
    );
    const { optimistic } = sent(operations);
    expect(optimistic.linkPatches).toEqual([]);
    expect(
      (optimistic.optimisticResponse as LogTimeMutation).logTime.task
        ?.properties
    ).toEqual([timeLogged(120)]);
  });

  it('leaves an entry dated before the first cached entry to the reply', async () => {
    // The cache applies the link recipe again over the server's page at
    // commit, so a prepend here would move the reply's ordered entry to the top.
    const { client, operations } = queuedClient();
    await logTime(
      {
        taskId: TASK,
        userId: AUTHOR,
        values: { ...values, date: '2026-11-19' },
        id: ENTRY,
      },
      {
        client,
        host: host([timeLogged(90)], true, '2026-11-20'),
        now: () => NOW,
      }
    );
    expect(sent(operations).optimistic.linkPatches).toEqual([]);

    const today = queuedClient();
    await logTime(
      { taskId: TASK, userId: AUTHOR, values, id: ENTRY },
      {
        client: today.client,
        host: host([timeLogged(90)], true, '2026-11-20'),
        now: () => NOW,
      }
    );
    expect(sent(today.operations).optimistic.linkPatches).toHaveLength(1);
  });

  it('predicts nothing about a task the cache does not hold', async () => {
    const { client, operations } = queuedClient();
    await logTime(
      { taskId: TASK, userId: AUTHOR, values },
      { client, host: host(undefined, false), now: () => NOW }
    );
    const { optimistic, variables } = sent(operations);
    const response = optimistic.optimisticResponse as LogTimeMutation;
    expect(response.logTime).not.toHaveProperty('task');
    expect(optimistic.linkPatches).toEqual([]);
    expect(optimistic.uuid).toBe(variables.input.id);
  });

  it('gives a first entry a task-scoped temporary Time logged', () => {
    const properties = withTimeLoggedChange(
      { __typename: 'GraphqlSoupDocument', id: TASK, properties: [priority] },
      30
    );
    expect(properties).toEqual([
      priority,
      {
        ...timeLogged(30),
        id: `optimistic-property:DOCUMENT:${TASK}:${SYSTEM_PROPERTY_IDS.TIME_LOGGED}`,
      },
    ]);
  });
});

describe('updateTimeEntry', () => {
  it('moves Time logged by the change and queues one edit per entry', async () => {
    const { client, operations } = queuedClient();
    const edited = { ...values, minutes: 60 };
    await updateTimeEntry(
      { entry, values: edited },
      { client, host: host([timeLogged(90)], true), now: () => NOW }
    );
    const { optimistic, variables } = sent(operations);
    expect(variables).toEqual({ input: { id: ENTRY, ...edited } });
    const response = optimistic.optimisticResponse as UpdateTimeEntryMutation;
    expect(response.updateTimeEntry.entry).toEqual({
      ...entry,
      ...edited,
      updatedAt: NOW.toISOString(),
    });
    expect(response.updateTimeEntry.task?.properties).toEqual([
      timeLogged(105),
    ]);
    expect(optimistic.uuid).toBe(timeEntryEditUuid(ENTRY));
    expect(timeEntryEditUuid(ENTRY)).toBe(timeEntryEditUuid(ENTRY));
    expect(timeEntryEditUuid(ENTRY)).not.toBe(
      timeEntryEditUuid('0196a000-0000-7000-8000-000000000002')
    );
  });
});

describe('deleteTimeEntry', () => {
  it('takes the entry off its page and its minutes off Time logged, never below zero', async () => {
    const { client, operations } = queuedClient();
    await deleteTimeEntry(
      { entry },
      { client, host: host([timeLogged(30)], true) }
    );
    const { optimistic, variables } = sent(operations);
    expect(variables).toEqual({ input: { id: ENTRY, taskId: TASK } });
    const response = optimistic.optimisticResponse as DeleteTimeEntryMutation;
    expect(response.deleteTimeEntry.deletedEntryId).toBe(ENTRY);
    expect(response.deleteTimeEntry.task?.properties).toEqual([timeLogged(0)]);
    expect(optimistic.linkPatches[0]).toMatchObject({
      operation: { kind: 'remove', entityKey: `GraphqlTimeEntry:${ENTRY}` },
    });
  });
});
