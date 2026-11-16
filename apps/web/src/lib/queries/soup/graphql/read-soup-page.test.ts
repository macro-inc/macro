import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import {
  hasOwnedEmailWitness,
  rememberOwnedEmail,
  requestNeedsCrmProof,
  retainOwnedEmailWitnesses,
} from '@graphql-cache/authority-scope';
import { selectRecords } from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import {
  parseCacheRevision,
  type ReadRecordsByKeysArgs,
} from '@graphql-cache/protocol';
import { markSourceAuthority } from '@graphql-cache/source-authority';
import { MailItemFieldsFragmentDoc } from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '@service-storage/graphql-soup';
import { afterEach, expect, it, vi } from 'vitest';

type PageHost = Pick<
  CacheHost,
  'readRecordsByKeys' | 'currentRevision' | 'authority'
>;
const fixture = vi.hoisted(() => ({
  host: undefined as PageHost | undefined,
  login: 0,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => fixture.host,
}));
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

import { readSoupPage } from './read-soup-page';

afterEach(() => {
  fixture.host = undefined;
  fixture.login++;
});

it('retains a later ownership reply until all overlapping readers release it', () => {
  const id = crypto.randomUUID();
  const first = retainOwnedEmailWitnesses([id]);
  const second = retainOwnedEmailWitnesses([id]);
  try {
    expect(hasOwnedEmailWitness(id)).toBe(false);
    rememberOwnedEmail(id, () => true);
    for (let index = 0; index < 1025; index++)
      rememberOwnedEmail(crypto.randomUUID(), () => true);
    expect(hasOwnedEmailWitness(id)).toBe(true);
    first();
    first();
    expect(hasOwnedEmailWitness(id)).toBe(true);
    second();
    expect(hasOwnedEmailWitness(id)).toBe(false);
  } finally {
    first();
    second();
  }
  expect(() =>
    retainOwnedEmailWitnesses(
      Array.from({ length: 501 }, () => crypto.randomUUID())
    )
  ).toThrow('Mail ownership retention exceeds one chunk');
});

it.each([
  { shared: false, count: 500 },
  { shared: true, count: 500 },
  { shared: false, count: 5000 },
])(
  'materializes $count offline Mail rows with batched ownership (shared: $shared)',
  async ({ shared, count }) => {
    const state: CacheAuthority = {
      identity: 'mail-page',
      account: 'viewer',
      generation: crypto.randomUUID(),
      policy: 'none',
      ready: true,
    };
    const owner: CacheAuthorityHost = {
      snapshot: () => state,
      current: async () => state,
      transition: vi.fn(),
      onChanged: () => () => {},
      setReadGuard: vi.fn(),
      verifyRead: vi.fn(),
    };
    const revision = parseCacheRevision('1');
    const proof = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    let fallback = false;
    let baseline: readonly GraphqlSoupItem[] = [];
    const host: PageHost = {
      authority: owner,
      currentRevision: async () => revision,
      readRecordsByKeys: vi.fn(async (request: ReadRecordsByKeysArgs) => {
        if (requestNeedsCrmProof('read-records-by-keys', request))
          await proof();
        return markSourceAuthority(
          {
            revision,
            records: request.keys.map((recordKey, index) => ({
              recordKey,
              record:
                request.fragmentName === 'EmailThreadOwnerFields'
                  ? {
                      id: recordKey.slice('GraphqlSoupEmailThread:'.length),
                      ownerId: shared && index === 0 ? 'teammate' : 'viewer',
                    }
                  : {
                      __typename: 'GraphqlSoupEmailThread',
                      id: recordKey.slice('GraphqlSoupEmailThread:'.length),
                      inboxVisible: true,
                      isRead: false,
                      isSignal: true,
                      mailAllPreview: fallback
                        ? null
                        : {
                            subject: 'Cached mail',
                            snippet: 'Cached preview',
                            isDraft: false,
                            senderEmail: null,
                            senderName: null,
                            senderPhotoUrl: null,
                          },
                    },
            })),
          },
          state.generation
        );
      }),
    };
    fixture.host = host;
    const keys = Array.from(
      { length: count },
      () => `GraphqlSoupEmailThread:${crypto.randomUUID()}`
    );
    const load = () =>
      readSoupPage(host, {
        page: {
          kind: 'mail-page',
          revision,
          keys,
          retainedKeys: [],
          optimistic: false,
          nextCursor: null,
          endCursor: null,
          sortTimestamps: keys.map(() => '2026-01-01T00:00:00Z'),
        },
        select: selectRecords(MailItemFieldsFragmentDoc),
        baseline,
        mailView: 'INBOX',
      });
    if (shared) {
      await expect(load()).rejects.toThrow('Failed to fetch');
      expect(proof).toHaveBeenCalledOnce();
      return;
    }
    const first = await load();
    expect(first.kind).toBe('ready');
    if (first.kind === 'ready') {
      expect(first.records).toHaveLength(count);
      expect(first.records[0]).toMatchObject({ emailName: 'Cached mail' });
      baseline = first.records;
    }
    expect(host.readRecordsByKeys).toHaveBeenCalledTimes((count / 500) * 2);
    expect(proof).not.toHaveBeenCalled();
    fallback = count > 500;
    const refreshed = await load();
    expect(refreshed.kind).toBe('ready');
    if (refreshed.kind === 'ready') {
      expect(refreshed.records).toHaveLength(count);
      expect(refreshed.records[0]).toMatchObject({ emailName: 'Cached mail' });
    }
    if (count === 500) expect(host.readRecordsByKeys).toHaveBeenCalledTimes(3);
    expect(proof).not.toHaveBeenCalled();
  }
);

it.each(['complete', 'read-failure', 'generation-change'] as const)(
  'retains an active Mail chunk across a concurrent deep read and releases it after %s',
  async (outcome) => {
    let state: CacheAuthority = {
      identity: 'split-mail-page',
      account: 'viewer',
      generation: crypto.randomUUID(),
      policy: 'none',
      ready: true,
    };
    const owner: CacheAuthorityHost = {
      snapshot: () => state,
      current: async () => state,
      transition: vi.fn(),
      onChanged: () => () => {},
      setReadGuard: vi.fn(),
      verifyRead: vi.fn(),
    };
    const revision = parseCacheRevision('1');
    const proof = vi.fn(async () => {
      throw new TypeError('CRM proof is offline');
    });
    const firstKeys = Array.from(
      { length: 500 },
      () => `GraphqlSoupEmailThread:${crypto.randomUUID()}`
    );
    const otherKeys = Array.from(
      { length: 1500 },
      () => `GraphqlSoupEmailThread:${crypto.randomUUID()}`
    );
    const readingFlags = Promise.withResolvers<void>();
    const releaseFlags = Promise.withResolvers<void>();
    let fallback = false;
    const host: PageHost = {
      authority: owner,
      currentRevision: async () => revision,
      readRecordsByKeys: async (request) => {
        if (requestNeedsCrmProof('read-records-by-keys', request))
          await proof();
        if (
          fallback &&
          request.keys[0] === firstKeys[0] &&
          request.fragmentName === 'MailInboxStateFields'
        ) {
          readingFlags.resolve();
          await releaseFlags.promise;
          if (outcome === 'read-failure') throw new Error('Flag read failed');
        }
        return markSourceAuthority(
          {
            revision,
            records: request.keys.map((recordKey) => ({
              recordKey,
              record:
                request.fragmentName === 'EmailThreadOwnerFields'
                  ? {
                      id: recordKey.slice('GraphqlSoupEmailThread:'.length),
                      ownerId: 'viewer',
                    }
                  : {
                      __typename: 'GraphqlSoupEmailThread',
                      id: recordKey.slice('GraphqlSoupEmailThread:'.length),
                      inboxVisible: true,
                      isRead: true,
                      isSignal: true,
                      mailAllPreview:
                        fallback && request.keys[0] === firstKeys[0]
                          ? null
                          : {
                              subject: 'Cached mail',
                              snippet: 'Cached preview',
                              isDraft: false,
                              senderEmail: null,
                              senderName: null,
                              senderPhotoUrl: null,
                            },
                    },
            })),
          },
          state.generation
        );
      },
    };
    fixture.host = host;
    const load = (keys: string[], baseline: readonly GraphqlSoupItem[] = []) =>
      readSoupPage(host, {
        page: {
          kind: 'mail-page',
          revision,
          keys,
          retainedKeys: [],
          optimistic: false,
          nextCursor: null,
          endCursor: null,
          sortTimestamps: keys.map(() => '2026-01-01T00:00:00Z'),
        },
        select: selectRecords(MailItemFieldsFragmentDoc),
        baseline,
        mailView: 'INBOX',
      });
    const initial = await load(firstKeys);
    expect(initial.kind).toBe('ready');
    if (initial.kind !== 'ready') throw new Error('Mail baseline unavailable');
    fallback = true;
    const pending = load(firstKeys, initial.records).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    try {
      await readingFlags.promise;
      // The other pane fills more than the idle witness capacity while this
      // pane is between its three independently selected fallback flags.
      await expect(load(otherKeys)).resolves.toMatchObject({ kind: 'ready' });
      if (outcome === 'generation-change')
        state = { ...state, generation: crypto.randomUUID() };
      releaseFlags.resolve();
      const result = await pending;
      if (outcome === 'complete') {
        expect(result.error).toBeUndefined();
        expect(result.value).toMatchObject({ kind: 'ready' });
        if (result.value?.kind === 'ready')
          expect(result.value.records).toHaveLength(firstKeys.length);
        expect(proof).not.toHaveBeenCalled();
      } else {
        expect(result.error).toEqual(
          outcome === 'read-failure'
            ? new Error('Flag read failed')
            : new TypeError('CRM proof is offline')
        );
      }
      // The concurrent page evicted these from idle retention. Completion,
      // failure and replacement must all release their temporary interest.
      expect(
        hasOwnedEmailWitness(
          firstKeys[0].slice('GraphqlSoupEmailThread:'.length)
        )
      ).toBe(false);
    } finally {
      releaseFlags.resolve();
      await pending;
    }
  }
);
