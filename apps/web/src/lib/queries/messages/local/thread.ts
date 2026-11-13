import {
  type CacheHost,
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
  MAX_CHANNEL_TIMELINE_PAGE,
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import {
  ChannelMessageDocument,
  type ChannelMessageFieldsFragment,
  ChannelMessageFieldsFragmentDoc,
  ChannelThreadDocument,
  type ChannelThreadInput,
  type ChannelThreadQuery,
} from '@service-storage/graphql/generated/graphql';
import type { MessageThread } from '@service-storage/messages';
import { fetchCached } from '../../calendar/graphql/network';
import { mapChannelMessage, mapChannelRoot } from './map';
import { channelMessageKey } from './sort-key';

export type ChannelThreadHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
>;

export type ChannelThreadServerPage =
  ChannelThreadQuery['user']['channelThread'];

export type FetchChannelThreadPage = (
  input: ChannelThreadInput
) => Promise<ChannelThreadServerPage>;

export type FetchChannelMessage = (
  channelId: string,
  messageId: string
) => Promise<ChannelMessageFieldsFragment | null>;

/** A thread longer than this many pages reads over REST. */
const MAX_THREAD_PAGES = 100;

const messageSelection = selectRecords(ChannelMessageFieldsFragmentDoc);

const fetchChannelThreadPage: FetchChannelThreadPage = async (input) =>
  (await fetchCached(ChannelThreadDocument, { input })).user.channelThread;

const fetchChannelMessage: FetchChannelMessage = async (channelId, messageId) =>
  (await fetchCached(ChannelMessageDocument, { channelId, messageId })).user
    .channelMessage;

function threadOf(
  root: ChannelMessageFieldsFragment,
  replies: readonly ChannelMessageFieldsFragment[]
): MessageThread | undefined {
  const item = mapChannelRoot(root);
  if (!item) return undefined;
  const { state, thread: _preview, ...message } = item;
  return { root: message, state, replies: replies.map(mapChannelMessage) };
}

/** Reads cached messages by id, in the order asked; undefined if any is absent. */
async function readMessages(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[]
): Promise<ChannelMessageFieldsFragment[] | undefined> {
  if (keys.length === 0) return [];
  const { records } = await readRecordsByKeys(host, messageSelection, [
    ...keys,
  ]);
  const byKey = new Map(
    records.map(({ recordKey, record }) => [recordKey, record])
  );
  const messages: ChannelMessageFieldsFragment[] = [];
  for (const key of keys) {
    const record = byKey.get(key);
    if (!record) return undefined;
    messages.push(record);
  }
  return messages;
}

/** The whole thread from the device, when it holds every reply. */
async function readDeviceThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string
): Promise<MessageThread | 'miss' | 'unsupported'> {
  const newestFirst: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const result = await host.channelTimeline({
      channelId,
      threadRootId: rootId,
      limit: MAX_CHANNEL_TIMELINE_PAGE,
      ...(before !== undefined && { before }),
    });
    if (result.kind === 'unsupported') return 'unsupported';
    if (!result.covered) return 'miss';
    newestFirst.push(...result.keys);
    if (result.olderCursor === null) {
      const [roots, replies] = await Promise.all([
        readMessages(host, [channelMessageKey(rootId)]),
        readMessages(host, newestFirst.reverse()),
      ]);
      const root = roots?.[0];
      if (!root || !replies) return 'miss';
      return threadOf(root, replies) ?? 'miss';
    }
    before = result.olderCursor;
  }
  return 'miss';
}

/** Every reply from the server, recorded as a fully held thread. */
async function fetchServerThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string,
  fetchPage: FetchChannelThreadPage
): Promise<MessageThread | undefined> {
  const first = await fetchPage({
    channelId,
    rootId,
    limit: MAX_CHANNEL_TIMELINE_PAGE,
  });
  const replies = new Map(first.replies.map((reply) => [reply.sortKey, reply]));
  let seq = first.seq;
  let pages = 1;
  for (const direction of ['before', 'after'] as const) {
    let cursor = direction === 'before' ? first.olderCursor : first.newerCursor;
    while (cursor !== null) {
      if (pages >= MAX_THREAD_PAGES) return undefined;
      const page = await fetchPage({
        channelId,
        rootId,
        limit: MAX_CHANNEL_TIMELINE_PAGE,
        [direction]: cursor,
      });
      pages += 1;
      for (const reply of page.replies) replies.set(reply.sortKey, reply);
      if (BigInt(page.seq) < BigInt(seq)) seq = page.seq;
      cursor = direction === 'before' ? page.olderCursor : page.newerCursor;
    }
  }
  await host.channelTimelineCommit({
    channelId,
    coverage: [
      {
        threadRootId: rootId,
        start: CHANNEL_TIMELINE_START,
        end: CHANNEL_TIMELINE_HEAD,
      },
    ],
    seq: { kind: 'lower', seq },
  });
  // Sort keys compare bytewise in display order.
  const ordered = [...replies.keys()]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap((key) => replies.get(key) ?? []);
  return threadOf(first.root, ordered);
}

/**
 * A channel thread with all its replies: from the device when it holds the
 * thread, otherwise from the server. Undefined when the device path cannot
 * answer, so the caller reads over REST.
 */
export async function loadChannelThread(
  host: ChannelThreadHost,
  channelId: string,
  rootId: string,
  fetchPage: FetchChannelThreadPage = fetchChannelThreadPage
): Promise<{ thread: MessageThread; source: 'device' | 'server' } | undefined> {
  return Telemetry.span('channel.thread_load', async (span) => {
    span.setAttr('channel.id', channelId);
    span.setAttr('thread.root_id', rootId);
    const device = await readDeviceThread(host, channelId, rootId);
    if (device === 'unsupported') {
      span.setAttr('thread.source', 'unsupported');
      return undefined;
    }
    if (device !== 'miss') {
      span.setAttr('thread.source', 'device');
      span.setAttr('thread.replies', device.replies.length);
      return { thread: device, source: 'device' as const };
    }
    const thread = await fetchServerThread(host, channelId, rootId, fetchPage);
    span.setAttr('thread.source', thread ? 'server' : 'too-long');
    if (!thread) return undefined;
    span.setAttr('thread.replies', thread.replies.length);
    return { thread, source: 'server' as const };
  });
}

/**
 * One message by id: the device's record when it holds one, otherwise the
 * server's. Null when the message does not exist.
 */
export async function loadChannelMessage(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  channelId: string,
  messageId: string,
  fetchMessage: FetchChannelMessage = fetchChannelMessage
): Promise<ChannelMessageFieldsFragment | null> {
  const held = await readMessages(host, [channelMessageKey(messageId)]);
  const record = held?.[0];
  if (record && record.channelId === channelId) return record;
  return fetchMessage(channelId, messageId);
}
