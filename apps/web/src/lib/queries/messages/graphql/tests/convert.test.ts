import { describe, expect, it } from 'vitest';
import { timelinePageFromGraphql, timelinePageToGraphql } from '../convert';
import { activity, at, messageEntry, page, reply, root } from './fixtures';

describe('channel page conversion', () => {
  const read = {
    seq: 41,
    page: page(
      [
        { type: 'activity' as const, activity: activity('a1', 9) },
        {
          type: 'call' as const,
          message: root('call', 8, { kind: 'call_root' }),
          status: {
            state: 'ended' as const,
            ended_at: at(9),
            duration_ms: 60_000,
          },
        },
        messageEntry('m2', 7, {
          edited_at: at(8),
          bot_profile: { name: 'Bot', avatar_url: null },
          mentions: [{ entity_type: 'user', entity_id: 'u1' }],
          reactions: [{ emoji: '👍', users: ['u1', 'u2'] }],
          attachments: [
            {
              id: 'att',
              entity_type: 'document',
              entity_id: 'd1',
              width: 10,
              height: 20,
              created_at: at(7),
            },
          ],
          thread: {
            reply_count: 3,
            latest_reply_at: at(9),
            preview: [reply('r1', 'm2', 8), reply('r2', 'm2', 9)],
          },
        }),
        messageEntry('m1', 5),
      ],
      { next_cursor: { created_at: at(5), id: 'm1' } }
    ),
  };

  it('stores a page in its order and reads back the page it stored', () => {
    const stored = timelinePageToGraphql(read);
    expect(stored.seq).toBe(41);
    expect(stored.entries.map((entry) => entry.id)).toEqual([
      'a1',
      'call',
      'm2',
      'm1',
    ]);
    expect(stored.olderCursor).toEqual({ createdAt: at(5), entryId: 'm1' });
    expect(stored.newerCursor).toBeNull();
    expect(timelinePageFromGraphql(stored)).toEqual(read);
  });

  it('reads a call row with its status and a plain row without one', () => {
    const stored = timelinePageToGraphql(read);
    const entries = timelinePageFromGraphql(stored).page.entries;
    expect(entries.map((entry) => entry.type)).toEqual([
      'activity',
      'call',
      'message',
      'message',
    ]);
  });
});
