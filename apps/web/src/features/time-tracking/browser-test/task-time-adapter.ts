import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { ok } from 'neverthrow';
import type { TimeWriteResult } from '../queries/write-result';

const QUEUED: TimeWriteResult = ok({ kind: 'queued' });

function entry(
  overrides: Partial<TimeEntryFieldsFragment>
): TimeEntryFieldsFragment {
  return {
    id: 'entry',
    taskId: 'task-1',
    userId: 'macro|viewer@example.com',
    date: new Date().toISOString().slice(0, 10),
    minutes: 30,
    note: null,
    startedAt: null,
    endedAt: null,
    source: 'MANUAL',
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    canEdit: true,
    ...overrides,
  };
}

/** The viewer's entries and a teammate's, as one task's list. */
const ENTRIES: TimeEntryFieldsFragment[] = [
  entry({
    id: 'theirs',
    userId: 'macro|teammate@example.com',
    minutes: 25,
    note: 'Sketches for the header',
    canEdit: false,
  }),
  entry({ id: 'mine-note', minutes: 30, note: 'Review' }),
  entry({ id: 'mine', minutes: 15 }),
];

export function createTimeEntryWrites() {
  return {
    update: (): Promise<TimeWriteResult> => Promise.resolve(QUEUED),
    remove: (): Promise<TimeWriteResult> => Promise.resolve(QUEUED),
  };
}

/** Stands in for the task's entries read; the sheet reads the same shape. */
export function createTaskTime() {
  return {
    entries: () => ENTRIES,
    pending: () => false,
    failed: () => false,
    hasOlder: () => false,
    olderPending: () => false,
    showOlder() {},
    refetch: () => Promise.resolve(),
    viewerId: () => 'macro|viewer@example.com',
    log: (): Promise<TimeWriteResult> => Promise.resolve(QUEUED),
    ...createTimeEntryWrites(),
  };
}

export type TaskTime = ReturnType<typeof createTaskTime>;
