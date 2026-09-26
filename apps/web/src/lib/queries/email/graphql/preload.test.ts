import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import {
  EmailThreadPageDocument,
  type EmailThreadPageFieldsFragment,
  type EmailThreadPageQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  Client,
  CombinedError,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { make, makeSubject, pipe, subscribe } from 'wonka';
import { retainGraphqlEmailThread } from './preload';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  enabled: vi.fn(() => true),
  revoke: vi.fn(async () => {}),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
  graphqlCacheEnabled: mocks.enabled,
}));
vi.mock('../cached-access', () => ({ revokeCachedEmailThread: mocks.revoke }));

function thread(): EmailThreadPageFieldsFragment {
  return {
    __typename: 'GraphqlSoupEmailThread',
    id: 'thread',
    providerId: null,
    linkId: 'mailbox',
    inboxVisible: true,
    isRead: true,
    projectId: null,
    latestInboundMessageTs: null,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    viewerPermission: {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'OWNER',
    },
    labels: [],
    messages: [],
  };
}

function setup() {
  const results = makeSubject<OperationResult<EmailThreadPageQuery>>();
  const operations: Operation[] = [];
  const client = new Client({
    url: 'http://local.test/graphql',
    exchanges: [
      () => (source) => {
        pipe(
          source,
          subscribe((operation) => operations.push(operation))
        );
        return results.source;
      },
    ],
  });
  mocks.client.mockReturnValue(client);
  function emit(
    value: EmailThreadPageFieldsFragment | null,
    stale = false,
    error?: CombinedError
  ) {
    const operation = operations.find((op) => op.kind === 'query');
    if (!operation) throw new Error('No subscribed query');
    results.next({
      operation,
      data: { user: { id: 'viewer', emailThread: value } },
      stale,
      hasNext: false,
      error,
    });
  }
  return { client, emit, operations };
}

describe('retained GraphQL email source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
  });

  it('delivers cached data immediately and keeps revalidation live for the foreground', async () => {
    const { client, emit, operations } = setup();
    const preload = retainGraphqlEmailThread('thread');
    emit(thread(), true);
    expect((await preload.ready)?.db_id).toBe('thread');
    const seen: OperationResult<EmailThreadPageQuery>[] = [];
    const foreground = client
      .query(
        EmailThreadPageDocument,
        { threadId: 'thread', offset: 0, limit: DEFAULT_THREAD_MESSAGES_LIMIT },
        { requestPolicy: 'cache-and-network' }
      )
      .subscribe((result) => seen.push(result));
    expect(seen[0]?.data?.user.emailThread?.id).toBe('thread');
    expect(
      operations.some((op) => op.context.requestPolicy === 'cache-and-network')
    ).toBe(true);
    preload.release();
    expect(operations.filter((op) => op.kind === 'teardown')).toHaveLength(0);
    emit({ ...thread(), isRead: false });
    expect(seen.at(-1)?.data?.user.emailThread?.isRead).toBe(false);
    foreground.unsubscribe();
    expect(operations.filter((op) => op.kind === 'teardown')).toHaveLength(1);
  });

  it('releases pending requests and makes late results ineligible', async () => {
    const { emit, operations } = setup();
    const preload = retainGraphqlEmailThread('thread');
    preload.release();
    preload.release();
    emit(thread());
    expect(await preload.ready).toBeUndefined();
    expect(operations.filter((op) => op.kind === 'teardown')).toHaveLength(1);
  });

  it('treats transport failure as retryable and does not revoke access', async () => {
    const { emit } = setup();
    const preload = retainGraphqlEmailThread('thread');
    emit(
      null,
      false,
      new CombinedError({ networkError: new Error('offline') })
    );
    expect(await preload.ready).toBeUndefined();
    expect(mocks.revoke).not.toHaveBeenCalled();
    const retry = retainGraphqlEmailThread('thread');
    emit(thread());
    expect((await retry.ready)?.db_id).toBe('thread');
    retry.release();
  });

  it('revokes cached source on a definitive denial, even with retained data', async () => {
    const { emit, operations } = setup();
    const preload = retainGraphqlEmailThread('thread');
    emit(thread(), true);
    await preload.ready;
    emit(
      thread(),
      false,
      new CombinedError({
        graphQLErrors: [
          { message: 'denied', extensions: { code: 'FORBIDDEN' } },
        ],
      })
    );
    expect(mocks.revoke).toHaveBeenCalledWith('thread');
    expect(operations.filter((op) => op.kind === 'teardown')).toHaveLength(1);
  });

  it('does not start an unsupported cache-only operation', async () => {
    mocks.enabled.mockReturnValue(false);
    expect(
      await retainGraphqlEmailThread('thread', true).ready
    ).toBeUndefined();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('bounds retention even when an oversized page arrives synchronously', async () => {
    const ended = vi.fn();
    const large: EmailThreadPageFieldsFragment = {
      ...thread(),
      messages: [
        {
          __typename: 'GraphqlSoupEmailMessage',
          id: 'message',
          threadId: 'thread',
          linkId: 'mailbox',
          providerId: null,
          replyingToId: null,
          subject: null,
          snippet: null,
          internalDateTs: null,
          sentAt: null,
          scheduledSendTime: null,
          isRead: true,
          isStarred: false,
          isSent: false,
          isDraft: false,
          hasAttachments: false,
          from: null,
          to: [],
          cc: [],
          bcc: [],
          labels: [],
          attachments: [],
          attachmentsDraft: [],
          attachmentsForwarded: [],
          createdAt: '2026-09-01',
          updatedAt: '2026-09-01',
          bodyHtmlSanitized: 'x'.repeat(600_000),
          bodyReplyless: null,
          bodyText: null,
          bodyMacro: null,
        },
      ],
    };
    const data: EmailThreadPageQuery = {
      user: { id: 'viewer', emailThread: large },
    };
    mocks.client.mockReturnValue({
      query: () =>
        make((observer) => {
          observer.next({ data } as OperationResult<EmailThreadPageQuery>);
          return ended;
        }),
    });
    const preload = retainGraphqlEmailThread('thread');
    expect((await preload.ready)?.messages).toHaveLength(1);
    expect(ended).toHaveBeenCalledOnce();
  });
});
