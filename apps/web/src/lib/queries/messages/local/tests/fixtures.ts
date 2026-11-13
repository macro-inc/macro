import type {
  CacheHost,
  CacheRevision,
  ChannelTimelineCacheArgs,
  ChannelTimelineCacheResult,
  ChannelTimelineCommitArgs,
  ChannelTimelineCommitCacheResult,
} from '@graphql-cache/index';
import type {
  ChannelMessageFieldsFragment,
  ChannelTimelineActivityFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import {
  channelActivityKey,
  channelMessageKey,
  rootSortKey,
} from '../sort-key';

export const CHANNEL_ID = '0198c0de-0000-7000-8000-000000000001';

const uuid = (n: number) =>
  `0198c0de-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** A root (or, with `threadId`, a reply) created `n` seconds into the fixture hour. */
export function graphqlMessage(
  n: number,
  overrides: Partial<ChannelMessageFieldsFragment> = {}
): ChannelMessageFieldsFragment {
  const id = uuid(n);
  const createdAt = `2026-11-01T10:00:${String(n).padStart(2, '0')}.000123Z`;
  const reply = overrides.threadId != null;
  return {
    __typename: 'GraphqlChannelMessage',
    id,
    channelId: CHANNEL_ID,
    threadId: null,
    kind: 'MESSAGE',
    sortKey: `${reply ? '~-' : ''}${rootSortKey(createdAt, id)}`,
    senderId: 'macro|sender@example.test',
    guestName: null,
    importedAuthorName: null,
    botProfile: null,
    mentions: [],
    triggeredBy: null,
    triggeredVia: null,
    content: `message ${n}`,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: null,
    attachments: [],
    reactions: [],
    thread: reply
      ? null
      : {
          resolved: false,
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
          userId: 'macro|sender@example.test',
          replyCount: 0,
          latestReplyAt: null,
          preview: [],
        },
    call: null,
    ...overrides,
  };
}

export function graphqlActivity(
  n: number
): ChannelTimelineActivityFieldsFragment {
  const id = uuid(n);
  const occurredAt = `2026-11-01T10:00:${String(n).padStart(2, '0')}.000000Z`;
  return {
    __typename: 'GraphqlChannelTimelineActivity',
    id,
    channelId: CHANNEL_ID,
    sortKey: rootSortKey(occurredAt, id) ?? '',
    actorId: 'macro|actor@example.test',
    occurredAt,
    action: 'member_joined',
    payload: null,
  };
}

export const keyOf = (
  record: ChannelMessageFieldsFragment | ChannelTimelineActivityFieldsFragment
) =>
  record.__typename === 'GraphqlChannelMessage'
    ? channelMessageKey(record.id)
    : channelActivityKey(record.id);

type FakeHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit' | 'readRecordsByKeys'
> & {
  reads: ChannelTimelineCacheArgs[];
  commits: ChannelTimelineCommitArgs[];
  records: Map<string, unknown>;
};

/**
 * A host answering timeline reads from a script, or from a function of the
 * request, and record reads from `records`.
 */
export function fakeHost(
  timeline:
    | ChannelTimelineCacheResult[]
    | ((args: ChannelTimelineCacheArgs) => ChannelTimelineCacheResult),
  options: {
    records?: Array<
      ChannelMessageFieldsFragment | ChannelTimelineActivityFieldsFragment
    >;
    commit?: (
      args: ChannelTimelineCommitArgs
    ) => ChannelTimelineCommitCacheResult;
  } = {}
): FakeHost {
  const script = Array.isArray(timeline) ? [...timeline] : undefined;
  const host: FakeHost = {
    reads: [],
    commits: [],
    records: new Map(
      (options.records ?? []).map((record) => [keyOf(record), record])
    ),
    async channelTimeline(args) {
      host.reads.push(args);
      if (!script)
        return (timeline as (a: typeof args) => ChannelTimelineCacheResult)(
          args
        );
      const next = script.shift();
      if (!next) throw new Error('unexpected channel timeline read');
      return next;
    },
    async channelTimelineCommit(args) {
      host.commits.push(args);
      return (
        options.commit?.(args) ?? {
          kind: 'committed',
          revision: '1' as CacheRevision,
          changed: [],
          channelSeq:
            args.seq?.kind === 'lower'
              ? args.seq.seq
              : args.seq?.kind === 'advance'
                ? args.seq.to
                : null,
        }
      );
    },
    async readRecordsByKeys({ keys }) {
      return {
        revision: '1' as CacheRevision,
        records: keys.flatMap((recordKey) => {
          const record = host.records.get(recordKey);
          return record ? [{ recordKey, record }] : [];
        }),
      };
    },
  };
  return host;
}

export function devicePage(
  keys: string[],
  overrides: Partial<Extract<ChannelTimelineCacheResult, { kind: 'page' }>> = {}
): ChannelTimelineCacheResult {
  return {
    kind: 'page',
    revision: '1' as CacheRevision,
    covered: true,
    keys,
    olderCursor: null,
    newerCursor: null,
    seq: '7',
    optimistic: false,
    ...overrides,
  };
}
