import { describe, expect, it } from 'vitest';
import { clearHides, type InboxClearState, withClear } from './inbox-clear';

const AS_OF = Date.parse('2026-02-01T10:30:00Z');

const clear = (fields: Partial<InboxClearState> = {}): InboxClearState => ({
  id: 'clear-1',
  status: 'applying',
  takes: { rowTypes: ['task'], unreadOnly: false },
  asOf: AS_OF,
  rows: 0,
  revision: 1,
  ...fields,
});

const row = (fields: {
  type?: 'task' | 'email';
  unseen?: boolean;
  at?: number;
}) => ({
  type: fields.type ?? ('task' as const),
  unseen: fields.unseen ?? true,
  latestAt: fields.at ?? AS_OF - 60_000,
});

describe('clearHides', () => {
  it('hides a row the clear takes that had arrived when it started', () => {
    expect(clearHides(clear(), row({}))).toBe(true);
    expect(clearHides(clear(), row({ at: AS_OF }))).toBe(true);
  });

  it('shows what arrived after the clear started', () => {
    expect(clearHides(clear(), row({ at: AS_OF + 1 }))).toBe(false);
  });

  it('shows kinds the clear does not take, and read rows under unread only', () => {
    expect(clearHides(clear(), row({ type: 'email' }))).toBe(false);
    const unread = clear({ takes: { rowTypes: ['task'], unreadOnly: true } });
    expect(clearHides(unread, row({ unseen: false }))).toBe(false);
    expect(clearHides(unread, row({ unseen: true }))).toBe(true);
  });

  it('hides nothing once the clear is done, undoing or undone', () => {
    for (const status of ['done', 'undoing', 'undone', 'failed'] as const) {
      expect(clearHides(clear({ status }), row({}))).toBe(false);
    }
  });
});

describe('withClear', () => {
  it('replaces a clear with a newer copy and drops an older one', () => {
    const held = [clear({ revision: 3, rows: 30 })];
    expect(withClear(held, clear({ revision: 4, rows: 40 }))).toEqual([
      clear({ revision: 4, rows: 40 }),
    ]);
    expect(withClear(held, clear({ revision: 2, rows: 20 }))).toBe(held);
  });
});
