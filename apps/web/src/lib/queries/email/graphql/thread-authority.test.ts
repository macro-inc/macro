import type { CacheAuthority } from '@graphql-cache/authority';
import {
  hasOwnedEmailWitness,
  queryNeedsCrmProof,
  rememberOwnedEmail,
  requestNeedsCrmProof,
} from '@graphql-cache/authority-scope';
import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { markSourceAuthority } from '@graphql-cache/source-authority';
import type {
  EmailThreadMessageFieldsFragment,
  EmailThreadPageQuery,
  EmailThreadPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  type GraphQLRequest,
  makeOperation,
  type OperationContext,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import type { DocumentNode } from 'graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

type IdentityHost = Pick<CacheHost, 'authority' | 'readRecordsByKeys'> &
  Partial<Pick<CacheHost, 'onCacheChanged'>>;
const fixture = vi.hoisted(() => ({
  host: undefined as IdentityHost | undefined,
  cached: true,
  login: 0,
}));
const cachedQuery = vi.hoisted(() => vi.fn());
const fallbackQuery = vi.hoisted(() => vi.fn());
const executeQuery = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => {
  const cached = { query: cachedQuery, executeQuery };
  const fallback = { query: fallbackQuery, executeQuery };
  return {
    getGraphqlCacheHost: () => fixture.host,
    graphqlCacheEnabled: () => fixture.cached,
    getGraphqlSoupClient: () => (fixture.cached ? cached : fallback),
  };
});
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAuthority: {
    account: () => 'viewer',
    captureSession: () => {
      const login = fixture.login;
      return () => {
        if (login !== fixture.login) throw new Error('login changed');
      };
    },
  },
}));

import {
  createGraphqlEmailThreadQuery,
  fetchGraphqlEmailThread,
} from './thread';

const page: EmailThreadPageQuery = {
  user: {
    id: 'viewer',
    emailThread: {
      __typename: 'GraphqlSoupEmailThread',
      id: 'thread',
      ownerId: 'viewer',
      entityType: 'EMAIL_THREAD',
      cacheProjection: null,
      displayName: null,
      emailName: null,
      snippet: null,
      senderEmail: null,
      senderName: null,
      senderPhotoUrl: null,
      isDraft: true,
      isSignal: false,
      isImportant: false,
      isFavorited: false,
      viewedAt: null,
      frecencyScore: null,
      mailAllPreview: null,
      mailDraftPreview: null,
      mailSentPreview: null,
      mailDraftState: null,
      participants: [],
      attachments: [],
      properties: [],
      notifications: [],
      providerId: null,
      linkId: 'link',
      inboxVisible: false,
      hasReceivedMail: false,
      isRead: true,
      projectId: null,
      latestInboundMessageTs: null,
      latestOutboundMessageTs: null,
      latestNonSpamMessageTs: null,
      reminderReturnedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      viewerPermission: {
        __typename: 'GraphqlAccessLevelPermission',
        accessLevel: 'OWNER',
      },
      labels: [],
      messages: [],
    },
  },
};

beforeEach(() => {
  fixture.cached = true;
  cachedQuery
    .mockReset()
    .mockImplementation(
      (document: DocumentNode, variables: EmailThreadPageQueryVariables) => ({
        toPromise: async () => {
          if (queryNeedsCrmProof(stringifyDocument(document), variables))
            throw new TypeError('CRM proof is offline');
          return { data: page };
        },
      })
    );
  fallbackQuery.mockReset().mockReturnValue({
    toPromise: async () => ({ data: page }),
  });
  executeQuery.mockReset();
});

afterEach(() => {
  fixture.host = undefined;
  fixture.login++;
});

it.each([false, true])(
  'recovers an ownership-read failure only after cache retirement (retired=%s)',
  async (retired) => {
    const state: CacheAuthority = {
      identity: 'thread-identity',
      account: 'viewer',
      generation: crypto.randomUUID(),
      policy: 'none',
      ready: false,
    };
    const reading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const read = vi.fn<IdentityHost['readRecordsByKeys']>(async (request) => {
      expect(request.fragmentName).toBe('EmailThreadOwnerFields');
      reading.resolve();
      await release.promise;
      throw new Error('cache initialization failed');
    });
    fixture.host = {
      authority: {
        snapshot: () => state,
        current: async () => state,
        transition: vi.fn(),
        onChanged: () => () => {},
        setReadGuard: vi.fn(),
        verifyRead: vi.fn(),
      },
      readRecordsByKeys: read,
    };
    const pending = fetchGraphqlEmailThread(crypto.randomUUID()).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    try {
      await reading.promise;
      if (retired) {
        fixture.cached = false;
        fixture.host = undefined;
      }
      release.resolve();
      const result = await pending;
      expect(cachedQuery).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledOnce();
      if (retired) {
        expect(result.error).toBeUndefined();
        expect(result.value?.db_id).toBe('thread');
        expect(fallbackQuery).toHaveBeenCalledOnce();
      } else {
        expect(result.error).toEqual(new Error('cache initialization failed'));
        expect(fallbackQuery).not.toHaveBeenCalled();
      }
    } finally {
      release.resolve();
      await pending;
    }
  }
);

it('retains canonical ownership through mounted refetch and pagination, then releases the route', async () => {
  const state: CacheAuthority = {
    identity: 'mounted-thread',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy: 'none',
    ready: false,
  };
  const first = crypto.randomUUID();
  const canonical = crypto.randomUUID();
  const second = crypto.randomUUID();
  fixture.host = {
    authority: {
      snapshot: () => state,
      current: async () => state,
      transition: vi.fn(),
      onChanged: () => () => {},
      setReadGuard: vi.fn(),
      verifyRead: vi.fn(),
    },
    onCacheChanged: () => () => {},
    readRecordsByKeys: async (request) => {
      if (requestNeedsCrmProof('read-records-by-keys', request))
        throw new TypeError('CRM proof is offline');
      const requested = request.keys[0].slice('GraphqlSoupEmailThread:'.length);
      const id = requested === first ? canonical : requested;
      return markSourceAuthority(
        {
          revision: parseCacheRevision('1'),
          records: [
            {
              recordKey: request.keys[0],
              record:
                request.fragmentName === 'EmailThreadOwnerFields'
                  ? { id, ownerId: 'viewer' }
                  : { id, cacheProjection: 'server-capsule' },
              identity: { mutationUuid: null, pending: false },
            },
          ],
        },
        state.generation
      );
    },
  };
  const message: EmailThreadMessageFieldsFragment = {
    __typename: 'GraphqlSoupEmailMessage',
    id: 'message',
    threadId: canonical,
    linkId: 'link',
    providerId: null,
    replyingToId: null,
    subject: 'Cached subject',
    snippet: null,
    internalDateTs: null,
    sentAt: null,
    isRead: true,
    isStarred: false,
    isSent: false,
    isDraft: false,
    hasAttachments: false,
    draftGeneration: 0,
    operationStatus: null,
    scheduledSendTime: null,
    scheduledSendStatus: null,
    from: null,
    to: [],
    cc: [],
    bcc: [],
    labels: [],
    bodyText: null,
    bodyHtmlSanitized: null,
    bodyMacro: null,
    calendarInvitations: [],
    bodyReplyless: null,
    attachments: [],
    attachmentsDraft: [],
    attachmentsForwarded: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const requests: Array<{ id: string; offset: number; emit(): void }> = [];
  const started = Array.from({ length: 4 }, () =>
    Promise.withResolvers<void>()
  );
  const proof = vi.fn();
  executeQuery.mockImplementation(
    (
      request: GraphQLRequest<
        EmailThreadPageQuery,
        EmailThreadPageQueryVariables
      >,
      context: Partial<OperationContext>
    ) => {
      const stream = makeSubject<OperationResult<EmailThreadPageQuery>>();
      const operation = makeOperation('query', request, {
        url: '/graphql',
        ...context,
        requestPolicy: context.requestPolicy ?? 'cache-and-network',
      });
      const variables = request.variables;
      const id = String(variables.threadId);
      requests.push({
        id,
        offset: variables.offset,
        emit: () => {
          if (queryNeedsCrmProof(stringifyDocument(request.query), variables)) {
            proof();
            stream.next({
              operation,
              stale: false,
              hasNext: false,
              error: new CombinedError({
                networkError: new Error('CRM proof is offline'),
              }),
            });
            return;
          }
          stream.next({
            operation,
            stale: false,
            hasNext: false,
            data: {
              user: {
                ...page.user,
                emailThread: {
                  ...page.user.emailThread!,
                  id,
                  messages:
                    variables.offset === 0
                      ? Array.from({ length: 20 }, (_, index) => ({
                          ...message,
                          id: `message-${index}`,
                        }))
                      : [],
                },
              },
            },
          });
        },
      });
      started[requests.length - 1].resolve();
      return stream.source;
    }
  );
  const [route, setRoute] = createSignal<string>(first);
  const root = createRoot((dispose) => ({
    dispose,
    ...createGraphqlEmailThreadQuery(route, () => ({ enabled: true })),
  }));
  try {
    await started[0].promise;
    requests[0].emit();
    expect(root.query.data?.pages[0].db_id).toBe(canonical);
    for (let index = 0; index < 1025; index++)
      rememberOwnedEmail(crypto.randomUUID(), () => true);

    const refreshed = root.query.refetch();
    await started[1].promise;
    requests[1].emit();
    await refreshed;
    expect(root.query.error).toBeNull();
    expect(hasOwnedEmailWitness(first)).toBe(true);
    expect(hasOwnedEmailWitness(canonical)).toBe(true);

    const nextPage = root.query.fetchNextPage();
    await started[2].promise;
    requests[2].emit();
    await nextPage;
    expect(root.query.data?.pageParams).toEqual([0, 20]);
    expect(requests.slice(0, 3).map(({ id, offset }) => [id, offset])).toEqual([
      [canonical, 0],
      [canonical, 0],
      [canonical, 20],
    ]);
    setRoute(second);
    await started[3].promise;
    requests[3].emit();
    expect(hasOwnedEmailWitness(first)).toBe(false);
    expect(hasOwnedEmailWitness(canonical)).toBe(false);
    expect(root.query.data?.pages[0].db_id).toBe(second);
    for (let index = 0; index < 1025; index++)
      rememberOwnedEmail(crypto.randomUUID(), () => true);
    expect(hasOwnedEmailWitness(second)).toBe(true);
    root.dispose();
    expect(hasOwnedEmailWitness(second)).toBe(false);
    expect(proof).not.toHaveBeenCalled();
  } finally {
    root.dispose();
  }
});

it.each([
  'complete',
  'canonical',
  'read-failure',
  'generation-change',
  'shared',
] as const)(
  'retains only current own-thread evidence through an identity read and releases it after %s',
  async (outcome) => {
    let state: CacheAuthority = {
      identity: 'thread-identity',
      account: 'viewer',
      generation: crypto.randomUUID(),
      policy: 'none',
      ready: false,
    };
    const id = crypto.randomUUID();
    const canonical = outcome === 'canonical' ? crypto.randomUUID() : id;
    const reading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const proof = vi.fn(async () => {
      throw new TypeError('CRM proof is offline');
    });
    fixture.host = {
      authority: {
        snapshot: () => state,
        current: async () => state,
        transition: vi.fn(),
        onChanged: () => () => {},
        setReadGuard: vi.fn(),
        verifyRead: vi.fn(),
      },
      readRecordsByKeys: async (request) => {
        if (request.fragmentName === 'EmailThreadIdentityFields') {
          reading.resolve();
          await release.promise;
        }
        if (requestNeedsCrmProof('read-records-by-keys', request))
          await proof();
        if (
          request.fragmentName === 'EmailThreadIdentityFields' &&
          outcome === 'read-failure'
        ) {
          throw new Error('identity read failed');
        }
        return markSourceAuthority(
          {
            revision: parseCacheRevision('1'),
            records: [
              {
                recordKey: request.keys[0],
                record:
                  request.fragmentName === 'EmailThreadOwnerFields'
                    ? {
                        id: canonical,
                        ownerId: outcome === 'shared' ? 'teammate' : 'viewer',
                      }
                    : { id: canonical, cacheProjection: null },
                identity: { mutationUuid: 'draft', pending: true },
              },
            ],
          },
          state.generation
        );
      },
    };
    const pending = fetchGraphqlEmailThread(id).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    try {
      await reading.promise;
      // Other mounted mail pages fill the idle map while native dispatch waits.
      for (let index = 0; index < 1025; index++)
        rememberOwnedEmail(crypto.randomUUID(), () => true);
      expect(hasOwnedEmailWitness(id)).toBe(outcome !== 'shared');
      if (outcome === 'generation-change') {
        state = { ...state, generation: crypto.randomUUID() };
        expect(hasOwnedEmailWitness(id)).toBe(false);
      }
      release.resolve();
      const result = await pending;
      if (outcome === 'complete' || outcome === 'canonical') {
        expect(result.error).toBeUndefined();
        expect(result.value?.db_id).toBe('thread');
        expect(cachedQuery).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          { threadId: canonical, offset: 0, limit: 20 },
          {
            requestPolicy:
              outcome === 'canonical' ? 'cache-and-network' : 'cache-only',
          }
        );
      } else {
        expect(result.error).toEqual(
          outcome === 'read-failure'
            ? new Error('identity read failed')
            : new TypeError('CRM proof is offline')
        );
        expect(cachedQuery).not.toHaveBeenCalled();
      }
      expect(proof).toHaveBeenCalledTimes(
        outcome === 'shared' || outcome === 'generation-change' ? 1 : 0
      );
      expect(fallbackQuery).not.toHaveBeenCalled();
      // Idle eviction already removed it, so this also checks the finally path.
      expect(hasOwnedEmailWitness(id)).toBe(false);
    } finally {
      release.resolve();
      await pending;
    }
  }
);
