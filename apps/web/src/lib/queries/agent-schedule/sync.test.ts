import { queryClient } from '@queries/client';
import type {
  ActionExecutionRecord,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import './sync';

const subscribe = vi.hoisted(() =>
  vi.fn<
    (callback: (message: { type: string; data: unknown }) => void) => void
  >()
);
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: subscribe,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const receive = subscribe.mock.calls[0][0];

const schedule: ScheduledAction = {
  id: 'routine',
  owner: 'macro|owner@example.com',
  name: 'Routine',
  kind: 'Agent',
  task: {},
  trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
  configuration_revision: 1,
  enabled: true,
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
};
const historyKey = scheduledActionKeys.history({
  scheduleId: 'routine',
}).queryKey;
const chat = { type: 'chat', id: 'same-id' } as const;
const agent = { type: 'agent', id: 'same-id' } as const;

function send(data: unknown, type = 'scheduled_action_update'): void {
  receive({ type, data });
}

function update(
  type: 'started' | 'stopped',
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type,
    owner: schedule.owner,
    action_id: schedule.id,
    ...(type === 'stopped' ? { is_success: true } : {}),
    ...fields,
  };
}

function history(): ActionExecutionRecord[] | undefined {
  return queryClient.getQueryData(historyKey);
}

function schedules(): ScheduledAction[] | undefined {
  return queryClient.getQueryData(scheduledActionKeys.list.queryKey);
}

beforeEach(() => {
  queryClient.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
    schedule,
    { ...schedule, id: 'other' },
  ]);
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scheduled-action websocket synchronization', () => {
  it.each([
    { chat_id: chat.id },
    { chat_id: chat.id, resource: chat },
    { chat_id: null, resource: agent },
  ])('syncs legacy and typed updates: %j', (fields) => {
    const resource = fields.resource ?? chat;
    send(JSON.stringify(update('started', fields)));
    expect(schedules()?.[0].claimed).toBe('2026-09-28T12:00:00.000Z');
    expect(schedules()?.[1]).toEqual({ ...schedule, id: 'other' });
    expect(history()).toEqual([
      {
        action_id: schedule.id,
        resource_id: resource.id,
        start_time: '2026-09-28T12:00:00.000Z',
        end_time: '2026-09-28T12:00:00.000Z',
        created_at: '2026-09-28T12:00:00.000Z',
        is_success: false,
        result: { version: 1, resource },
      },
    ]);

    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    send(update('stopped', fields));
    send(update('stopped', fields));
    expect(history()).toEqual([]);
    expect(schedules()?.[0].claimed).toBeUndefined();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKey });
  });

  it('deduplicates repeated starts without resetting the pending timestamp', () => {
    send(update('started', { resource: agent }));
    const first = history();
    vi.setSystemTime(new Date('2026-09-28T12:01:00Z'));
    send(update('started', { resource: agent }));
    expect(history()).toBe(first);
    expect(history()).toHaveLength(1);
  });

  it('deduplicates old/new chat messages and matches legacy pending history', () => {
    send(update('started', { chat_id: chat.id }));
    send(update('started', { resource: chat }));
    expect(history()).toHaveLength(1);
    // Generated JSON-column typing omits the historical null/string values.
    queryClient.setQueryData(historyKey, [{ ...history()?.[0], result: null }]);
    send(update('started', { resource: chat }));
    expect(history()).toHaveLength(1);
    send(update('stopped', { resource: chat }));
    expect(history()).toEqual([]);
  });

  it('keeps identical IDs with different resource types distinct', () => {
    send(update('started', { resource: chat }));
    send(update('started', { resource: agent, chat_id: chat.id }));
    expect(history()).toHaveLength(2);
    send(update('stopped', { resource: agent, chat_id: chat.id }));
    expect(history()).toHaveLength(1);
    expect(history()?.[0].result).toEqual({ version: 1, resource: chat });
    send(update('stopped', { chat_id: chat.id }));
    expect(history()).toEqual([]);
  });

  it('retains persisted records on stops and does not add duplicates on starts', () => {
    send(update('started', { resource: agent }));
    queryClient.setQueryData(historyKey, [
      { ...history()?.[0], id: 'persisted', is_success: true },
    ]);
    const persisted = history();
    send(update('started', { resource: agent }));
    expect(history()).toBe(persisted);
    send(update('stopped', { resource: agent, is_success: false }));
    expect(history()).toEqual(persisted);
  });

  it.each([
    {},
    { chat_id: null },
    { chat_id: 123 },
    { resource: null, chat_id: chat.id },
    { resource: {}, chat_id: chat.id },
    { resource: { type: 'future', id: chat.id }, chat_id: chat.id },
    { resource: { type: 'agent', id: '' }, chat_id: chat.id },
  ])('syncs claims without inventing a resource for %j', (fields) => {
    send(update('started', fields));
    expect(schedules()?.[0].claimed).toBeDefined();
    expect(history()).toBeUndefined();
    // An unrecognized resource must not remove a chat with the same ID.
    send(update('started', { resource: chat }));
    const pending = history();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    send(update('stopped', fields));
    expect(schedules()?.[0].claimed).toBeUndefined();
    expect(history()).toEqual(pending);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKey });
  });

  it.for([
    '{broken',
    'null',
    null,
    undefined,
    [],
    {},
    { type: 'unknown', action_id: 'routine' },
    { type: 'started' },
    { type: 'stopped', action_id: 123 },
    { type: 'started', action_id: '' },
    { type: 'stopped', action_id: '  ' },
  ])('ignores malformed messages: %j', (payload) => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const before = schedules();
    expect(() => send(payload)).not.toThrow();
    expect(schedules()).toBe(before);
    expect(history()).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores unrelated websocket events', () => {
    send(update('started', { resource: agent }), 'other_event');
    expect(schedules()?.[0].claimed).toBeUndefined();
    expect(history()).toBeUndefined();
  });

  it('handles stop-before-start and uncached schedules without creating rows', () => {
    queryClient.clear();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    send(update('stopped', { resource: agent }));
    expect(history()).toBeUndefined();
    expect(schedules()).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: historyKey });
    send(update('started', { resource: agent }));
    expect(history()).toHaveLength(1);
    expect(schedules()).toBeUndefined();
  });

  it('isolates history by routine ID', () => {
    send(update('started', { resource: agent }));
    send(update('stopped', { resource: agent, action_id: 'other' }));
    expect(history()).toHaveLength(1);
    expect(schedules()?.[0].claimed).toBeDefined();
  });
});
