import type { MessageTimelineEntry } from '@service-storage/messages';
import { describe, expect, it } from 'vitest';
import { outsideMessages } from './outside-messages';

const ME = 'macro|me@example.com';
const THEM = 'macro|them@example.com';
const SINCE = '2026-11-05T12:00:00Z';

function entry(
  id: string,
  options: { sender?: string; at?: string; deleted?: boolean } = {}
) {
  return {
    type: 'message',
    message: {
      id,
      sender_id: options.sender ?? THEM,
      created_at: options.at ?? '2026-11-05T12:05:00Z',
      deleted_at: options.deleted ? '2026-11-05T12:06:00Z' : null,
    },
  } as unknown as MessageTimelineEntry;
}

function ids(entries: MessageTimelineEntry[]) {
  return outsideMessages(entries, { since: SINCE, currentUserId: ME }).map(
    (message) => message.id
  );
}

describe('outsideMessages', () => {
  it('counts what others posted to the channel since then', () => {
    expect(ids([entry('new')])).toEqual(['new']);
  });

  it('leaves out older messages, your own and deleted ones', () => {
    expect(
      ids([
        entry('older', { at: '2026-11-05T11:59:00Z' }),
        entry('mine', { sender: ME }),
        entry('deleted', { deleted: true }),
      ])
    ).toEqual([]);
  });

  it('leaves out call rows and activity, which are not messages to catch up on', () => {
    const call = {
      ...entry('call'),
      type: 'call',
      status: { state: 'live' },
    } as unknown as MessageTimelineEntry;
    const activity = {
      type: 'activity',
      activity: { id: 'a', occurred_at: '2026-11-05T12:05:00Z' },
    } as unknown as MessageTimelineEntry;

    expect(ids([call, activity])).toEqual([]);
  });
});
