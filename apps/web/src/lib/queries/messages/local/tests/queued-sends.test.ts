import type { MutationInspection } from '@graphql-cache/protocol';
import type { MessageTimelinePage } from '@service-storage/messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapChannelTimelineEntry } from '../map';
import { setQueueOwner } from '../queue-owner';
import { pageLacksQueuedSends, withQueuedSends } from '../queued-sends';
import { CHANNEL_ID, graphqlMessage } from './fixtures';

type Row = ReturnType<typeof graphqlMessage>;

const pageOf = (
  rows: Row[],
  previousCursor: MessageTimelinePage['previous_cursor'] = null
): MessageTimelinePage => ({
  entries: rows.flatMap((row) => mapChannelTimelineEntry(row) ?? []),
  next_cursor: null,
  previous_cursor: previousCursor,
});

const idsOf = (page: MessageTimelinePage) =>
  page.entries.flatMap((entry) =>
    entry.type === 'activity' ? [] : [entry.message.id]
  );

const queuedSend = (
  row: Row,
  overrides: Partial<MutationInspection> = {}
): MutationInspection => ({
  transactionId: row.id,
  uuid: row.id,
  superseded: false,
  query: '',
  operationName: 'SendChannelMessage',
  variables: {
    input: {
      channelId: row.channelId,
      id: row.id,
      content: row.content,
      threadId: row.threadId,
      mentions: [],
      attachments: [],
      nonce: row.id,
    },
  },
  clientMetadata: null,
  enqueuedAtMs: Date.parse('2026-01-02T03:04:05.000Z'),
  // Not relied on: a queue read back after a reload lists it empty.
  optimisticData: {},
  ...overrides,
});

const hostWith = (mutations: MutationInspection[]) => ({
  inspectMutations: async () => mutations,
});

const SENDER = 'macro|sender@example.test';

const queuedDelete = (id: string): MutationInspection => ({
  ...queuedSend(graphqlMessage(9)),
  operationName: 'DeleteChannelMessage',
  variables: { input: { channelId: CHANNEL_ID, id, nonce: 'n' } },
});

describe('withQueuedSends', () => {
  beforeEach(() => setQueueOwner(SENDER));
  afterEach(() => setQueueOwner(undefined));

  const placed = graphqlMessage(1);
  const first = graphqlMessage(2);
  const second = graphqlMessage(3);

  it('puts waiting messages the page lacks after everything placed, in the order queued', async () => {
    const host = hostWith([queuedSend(first), queuedSend(second)]);
    const page = pageOf([placed]);
    expect(idsOf(await withQueuedSends(host, CHANNEL_ID, page))).toEqual([
      second.id,
      first.id,
      placed.id,
    ]);
    expect(await pageLacksQueuedSends(host, CHANNEL_ID, page)).toBe(true);
  });

  it('draws the message as it was written, by the person whose queue it is', async () => {
    const host = hostWith([queuedSend(first)]);
    const [entry] = (await withQueuedSends(host, CHANNEL_ID, pageOf([])))
      .entries;
    expect(entry).toMatchObject({
      message: {
        id: first.id,
        content: first.content,
        sender_id: SENDER,
        created_at: '2026-01-02T03:04:05.000Z',
      },
    });
  });

  it('leaves out a message whose deletion waits behind it', async () => {
    const host = hostWith([queuedSend(first), queuedDelete(first.id)]);
    const page = pageOf([placed]);
    expect(await withQueuedSends(host, CHANNEL_ID, page)).toBe(page);
  });

  it('shows nothing while no one is signed in', async () => {
    setQueueOwner(undefined);
    const host = hostWith([queuedSend(first)]);
    const page = pageOf([placed]);
    expect(await withQueuedSends(host, CHANNEL_ID, page)).toBe(page);
  });

  it('puts a missing message before a later waiting one the page carries', async () => {
    const third = graphqlMessage(4);
    const host = hostWith([
      queuedSend(first),
      queuedSend(second),
      queuedSend(third),
    ]);
    // The page holds the second only, drawn after a message placed since.
    const page = pageOf([second, placed]);
    expect(idsOf(await withQueuedSends(host, CHANNEL_ID, page))).toEqual([
      third.id,
      second.id,
      first.id,
      placed.id,
    ]);
  });

  it('does not repeat a message the page already carries', async () => {
    const host = hostWith([queuedSend(first)]);
    const page = pageOf([first, placed]);
    expect(await withQueuedSends(host, CHANNEL_ID, page)).toBe(page);
    expect(await pageLacksQueuedSends(host, CHANNEL_ID, page)).toBe(false);
  });

  it('leaves out replies, other channels, other writes and superseded sends', async () => {
    const host = hostWith([
      queuedSend({ ...first, threadId: placed.id }),
      queuedSend({ ...first, channelId: 'another-channel' }),
      queuedSend(first, { operationName: 'EditChannelMessage' }),
      queuedSend(first, { superseded: true }),
      queuedSend(first, { variables: { input: { id: first.id } } }),
    ]);
    const page = pageOf([placed]);
    expect(await withQueuedSends(host, CHANNEL_ID, page)).toBe(page);
  });

  it('leaves a page that does not reach the newest message alone', async () => {
    const host = hostWith([queuedSend(first)]);
    const page = pageOf([placed], {
      created_at: placed.createdAt,
      id: placed.id,
    });
    expect(await withQueuedSends(host, CHANNEL_ID, page)).toBe(page);
  });

  it('answers with the page when the queue cannot be listed', async () => {
    const page = pageOf([placed]);
    const failing = {
      inspectMutations: async () => {
        throw new Error('queue unavailable');
      },
    };
    expect(await withQueuedSends(failing, CHANNEL_ID, page)).toBe(page);
    expect(await withQueuedSends({}, CHANNEL_ID, page)).toBe(page);
  });
});
