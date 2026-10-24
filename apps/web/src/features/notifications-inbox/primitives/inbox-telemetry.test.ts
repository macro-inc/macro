import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { traceInboxRows } from './inbox-telemetry';

const telemetry = vi.hoisted(() => {
  type Recorded = {
    name: string;
    attributes: Record<string, unknown>;
    errors: unknown[];
  };
  const spans: Recorded[] = [];
  return {
    spans,
    span: (name: string, work: (span: unknown) => Promise<unknown>) => {
      const recorded: Recorded = { name, attributes: {}, errors: [] };
      spans.push(recorded);
      return work({
        setAttr: (key: string, value: unknown) => {
          recorded.attributes[key] = value;
        },
        error: (error: unknown) => recorded.errors.push(error),
      });
    },
  };
});

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { span: telemetry.span },
}));

const row = (id: string): NotificationInboxRow => ({
  id,
  type: 'access_requested',
  revision: 'rev',
  latestAt: 1,
  actions: [],
  unseen: true,
  count: 1,
  content: { entity: {} as never, notifications: [] },
});

afterEach(() => {
  telemetry.spans.length = 0;
});

describe('traceInboxRows', () => {
  it('records the row and a success', async () => {
    const result = await traceInboxRows(
      'notifications_inbox.row_done',
      [row('document:a#access_requested:r')],
      async () => 'ok'
    );
    expect(result).toBe('ok');
    expect(telemetry.spans).toEqual([
      {
        name: 'notifications_inbox.row_done',
        attributes: {
          'inbox.rows': 1,
          'inbox.row_types': 'access_requested',
          'inbox.row_id': 'document:a#access_requested:r',
          'inbox.outcome': 'succeeded',
        },
        errors: [],
      },
    ]);
  });

  it('records the count and types, not ids, for several rows', async () => {
    await traceInboxRows(
      'notifications_inbox.row_done',
      [row('a#task'), row('b#task')],
      async () => undefined
    );
    expect(telemetry.spans[0]?.attributes).toEqual({
      'inbox.rows': 2,
      'inbox.row_types': 'access_requested',
      'inbox.outcome': 'succeeded',
    });
  });

  it('marks a failure without the error message and rethrows', async () => {
    const failure = new Error('Plan for Acme could not be updated');
    await expect(
      traceInboxRows('notifications_inbox.row_undo', [row('a#task')], () =>
        Promise.reject(failure)
      )
    ).rejects.toBe(failure);
    expect(telemetry.spans[0]?.attributes['inbox.outcome']).toBe('failed');
    expect(telemetry.spans[0]?.errors).toEqual([
      'notifications_inbox.row_undo failed',
    ]);
  });
});
