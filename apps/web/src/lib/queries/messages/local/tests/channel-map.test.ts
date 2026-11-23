import { describe, expect, it } from 'vitest';
import {
  cursorFromSortKey,
  mapChannelTimelineEntry,
  rootSortKey,
  sortKeyFromCursor,
  unplacedSortKey,
} from '../channel-map';
import { CHANNEL_ID, graphqlActivity, graphqlMessage } from './fixtures';
const ID = '0198c0de-0000-7000-8000-00000000000a';

describe('channel sort keys', () => {
  it('keeps the stored microseconds a Date would drop', () => {
    expect(rootSortKey('2026-11-01T10:00:00.123456Z', ID)).toBe(
      `00001793527200123456-${ID}`
    );
  });

  it('reads offsets and short or absent fractions', () => {
    const utc = rootSortKey('2026-11-01T10:00:00Z', ID);
    expect(rootSortKey('2026-11-01T12:00:00+02:00', ID)).toBe(utc);
    expect(rootSortKey('2026-11-01T10:00:00.5Z', ID)).toBe(
      `00001793527200500000-${ID}`
    );
  });

  it('orders bytewise like (created_at, id)', () => {
    const keys = [
      rootSortKey('2026-11-01T10:00:00.000002Z', ID),
      rootSortKey('2026-11-01T10:00:00.000001Z', ID),
      rootSortKey('2026-11-01T09:59:59.999999Z', ID),
    ];
    expect([...keys].sort()).toEqual([...keys].reverse());
  });

  it('round-trips a cursor through its sort key', () => {
    const cursor = { created_at: '2026-11-01T10:00:00.123456Z', id: ID };
    const key = sortKeyFromCursor(cursor);
    expect(key && cursorFromSortKey(key)).toEqual(cursor);
  });

  it('rejects what is not a root position', () => {
    expect(rootSortKey('not a time', ID)).toBeUndefined();
    expect(cursorFromSortKey(`~-00001793527200123456-${ID}`)).toBeUndefined();
  });

  it('sorts an unplaced message after every placed one, in the order written', () => {
    const placed = rootSortKey('2026-11-01T10:00:05Z', ID);
    const first = unplacedSortKey('2026-11-01T10:00:00Z', ID, false);
    const second = unplacedSortKey('2026-11-01T10:00:01Z', ID, false);
    expect(placed && first && second && placed < first && first < second).toBe(
      true
    );
    expect(first && cursorFromSortKey(first)).toBeDefined();
  });

  it('sorts an unplaced reply after live and imported ones', () => {
    const reply = unplacedSortKey('2026-11-01T10:00:00Z', ID, true);
    const live = `~-${rootSortKey('2026-11-01T10:00:05Z', ID)}`;
    expect(reply && reply > live && live > `00000000000000000009-${ID}`).toBe(
      true
    );
  });
});

describe('mapChannelTimelineEntry', () => {
  it('maps a root to the row the channel renders', () => {
    const reply = graphqlMessage(2, { threadId: graphqlMessage(1).id });
    const root = graphqlMessage(1, {
      editedAt: '2026-11-01T10:05:00.000000Z',
      mentions: [{ entityType: 'user', entityId: 'u1' }],
      attachments: [
        {
          attachmentId: 'a1',
          entityType: 'document',
          entityId: 'd1',
          width: 10,
          height: null,
          createdAt: '2026-11-01T10:00:01.000000Z',
        },
      ],
      reactions: [{ emoji: '👍', users: ['u1', 'u2'] }],
      thread: {
        resolved: true,
        deletedAt: null,
        createdAt: '2026-11-01T10:00:01.000123Z',
        updatedAt: '2026-11-01T10:06:00.000000Z',
        userId: 'macro|sender@example.test',
        replyCount: 1,
        latestReplyAt: reply.createdAt,
        preview: [reply],
      },
    });
    const entry = mapChannelTimelineEntry(root);
    expect(entry).toMatchObject({
      type: 'message',
      message: {
        id: root.id,
        parent: { type: 'channel', id: CHANNEL_ID },
        thread_id: null,
        kind: 'message',
        content: 'message 1',
        edited_at: '2026-11-01T10:05:00.000000Z',
        mentions: [{ entity_type: 'user', entity_id: 'u1' }],
        attachments: [
          { id: 'a1', entity_type: 'document', entity_id: 'd1', width: 10 },
        ],
        reactions: [{ emoji: '👍', users: ['u1', 'u2'] }],
        sender: { type: 'user' },
        state: { root_id: root.id, resolved: true, deleted_at: null },
        thread: {
          reply_count: 1,
          latest_reply_at: reply.createdAt,
          preview: [
            { id: reply.id, thread_id: root.id, sender: { type: 'user' } },
          ],
        },
      },
    });
  });

  it('derives a bot sender from its profile', () => {
    const entry = mapChannelTimelineEntry(
      graphqlMessage(1, {
        senderId: 'bot|helper',
        botProfile: { name: 'Helper', avatarUrl: null },
        triggeredBy: 'macro|user@example.test',
        triggeredVia: 'Client',
      })
    );
    expect(entry).toMatchObject({
      message: {
        sender: {
          name: 'Helper',
          triggered_by: 'macro|user@example.test',
          triggered_via: 'Client',
        },
      },
    });
  });

  it('maps an ended call with its duration and skips an unreadable one', () => {
    const call = graphqlMessage(1, {
      kind: 'CALL_ROOT',
      call: {
        state: 'ENDED',
        endedAt: '2026-11-01T10:30:00.000000Z',
        durationMs: 1800000,
      },
    });
    expect(mapChannelTimelineEntry(call)).toMatchObject({
      type: 'call',
      status: {
        state: 'ended',
        ended_at: '2026-11-01T10:30:00.000000Z',
        duration_ms: 1800000,
      },
    });
    expect(mapChannelTimelineEntry({ ...call, call: null })).toBeUndefined();
  });

  it('maps an activity and leaves a reply out of the channel list', () => {
    expect(mapChannelTimelineEntry(graphqlActivity(3))).toEqual({
      type: 'activity',
      activity: {
        id: graphqlActivity(3).id,
        actor_id: 'macro|actor@example.test',
        occurred_at: '2026-11-01T10:00:03.000000Z',
        action: 'member_joined',
      },
    });
    expect(
      mapChannelTimelineEntry(graphqlMessage(2, { threadId: 'root' }))
    ).toBeUndefined();
  });
});
