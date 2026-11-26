import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTaskTimeEntriesQuery } from './time-entries';

const entry: TimeEntryFieldsFragment = {
  id: 'entry-1',
  taskId: 'task-1',
  userId: 'macro|author@example.com',
  date: '2026-11-18',
  minutes: 30,
  note: null,
  startedAt: null,
  endedAt: null,
  source: 'MANUAL',
  createdAt: '2026-11-18T09:00:00.000Z',
  updatedAt: '2026-11-18T09:00:00.000Z',
  canEdit: true,
};

let state: {
  isPending: boolean;
  isError: boolean;
  data:
    | { entries: TimeEntryFieldsFragment[]; nextCursor: string | null }
    | undefined;
};

vi.mock('@graphql-cache/solid/create-live-query', () => ({
  createLiveQuery: () => ({
    get isPending() {
      return state.isPending;
    },
    get isError() {
      return state.isError;
    },
    get data() {
      return state.data;
    },
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  state = { isPending: true, isError: false, data: undefined };
});

function read() {
  return createRoot((dispose) => {
    const query = createTaskTimeEntriesQuery(
      () => 'task-1',
      () => ({}) as Client
    );
    const result = {
      entries: query.entries(),
      nextCursor: query.nextCursor(),
      failed: query.failed(),
    };
    dispose();
    return result;
  });
}

it('keeps the last page on screen when a refetch fails', () => {
  state = {
    isPending: false,
    isError: true,
    data: { entries: [entry], nextCursor: 'next' },
  };
  expect(read()).toEqual({
    entries: [entry],
    nextCursor: 'next',
    failed: false,
  });
});

it('fails only when there is nothing to show', () => {
  state = { isPending: false, isError: true, data: undefined };
  expect(read()).toEqual({ entries: [], nextCursor: undefined, failed: true });
});
