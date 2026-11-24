import {
  currentQueryAccount,
  resetQueryAccountSession,
} from '@queries/auth/account-scope';
import { authKeys } from '@queries/auth/keys';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type {
  CrmEmailPrivacyResponse,
  crmEmailPrivacyClient,
} from '@service-storage/crm-email-privacy';
import { waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailConsent, EmailPrivacy } from '../core/email-privacy';
import {
  createEmailConsentQuery,
  createEmailPrivacySource,
  createThreadExclusionQuery,
} from './email-privacy';
import { crmKeys } from './keys';

type PrivacyClient = typeof crmEmailPrivacyClient;
let accountClient: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return accountClient;
  },
}));

const settings: CrmEmailPrivacyResponse = {
  enabled: true,
  mailbox_email: 'person@example.com',
  team_domains: [],
  personal_domains: [],
  team_domain_warnings: {},
  personal_domain_warnings: {},
  can_remove_team_domains: false,
};
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mount(initial: Partial<CrmEmailPrivacyResponse> = {}) {
  return createRoot((dispose) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    accountClient = client;
    cleanups.push(() => {
      dispose();
      client.clear();
    });
    const privacy = {
      excludedThreads: vi
        .fn<PrivacyClient['excludedThreads']>()
        .mockResolvedValue(ok({ threads: [], next_cursor: null })),
      get: vi
        .fn<PrivacyClient['get']>()
        .mockResolvedValue(ok({ ...settings, ...initial })),
      getConsent: vi
        .fn<PrivacyClient['getConsent']>()
        .mockResolvedValue(ok({ ...settings, ...initial })),
      update: vi.fn<PrivacyClient['update']>().mockResolvedValue(ok(settings)),
    };
    const feedback = { success: vi.fn(), failure: vi.fn() };
    const [team, setTeam] = createSignal<string>();
    const [user, setUser] = createSignal<string>();
    const [primaryLink, setPrimaryLink] = createSignal<string>();
    const source = createEmailPrivacySource(
      { client, privacy, feedback },
      team,
      user,
      primaryLink
    );
    const createStatus = (threadId: Accessor<string | undefined>) =>
      createThreadExclusionQuery(
        { client, privacy, feedback },
        team,
        user,
        threadId
      );
    const createConsent = () =>
      createEmailConsentQuery({ client, privacy, feedback }, team, user);
    return {
      source,
      client,
      privacy,
      feedback,
      setTeam,
      setUser,
      setPrimaryLink,
      createStatus,
      createConsent,
    };
  });
}

async function signIn(h: ReturnType<typeof mount>) {
  await resetQueryAccountSession();
  await h.client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => ({ id: 'user', authenticated: true }),
  });
  h.setTeam('team');
  h.setUser('user');
  await waitFor(() => expect(h.source.query.isSuccess).toBe(true));
}

describe('CRM email privacy query adapter', () => {
  it('waits for team and user identity and handles a disconnected mailbox', async () => {
    const h = mount({ enabled: false, mailbox_email: undefined });
    expect(h.privacy.get).not.toHaveBeenCalled();
    h.setTeam('team');
    expect(h.privacy.get).not.toHaveBeenCalled();
    h.setUser('user');
    await waitFor(() => expect(h.source.query.isSuccess).toBe(true));
    expect(h.source.query.data?.mailboxEmail).toBeNull();
    expect(h.source.query.data?.enabled).toBe(false);
  });

  it('rereads settings once a newly linked primary mailbox appears, leaving sharing off', async () => {
    const h = mount({
      enabled: false,
      mailbox_email: undefined,
      mailbox_link_id: undefined,
    });
    await signIn(h);
    expect(h.source.query.data?.mailboxLinkId).toBeNull();
    const policyKey = crmKeys.emailPolicy('scope').queryKey;
    h.client.setQueryData(policyKey, { mailbox_email: null });
    h.privacy.get.mockResolvedValue(
      ok({
        ...settings,
        enabled: false,
        mailbox_email: 'person@example.com',
        mailbox_link_id: 'link-1',
      })
    );

    h.setPrimaryLink('link-1');

    await waitFor(() =>
      expect(h.source.query.data?.mailboxLinkId).toBe('link-1')
    );
    expect(h.source.query.data?.enabled).toBe(false);
    expect(h.client.getQueryState(policyKey)?.isInvalidated).toBe(true);
    expect(h.privacy.get).toHaveBeenCalledTimes(2);
    expect(h.privacy.update).not.toHaveBeenCalled();
  });

  it('refreshes CRM records and email lists after adding an exclusion', async () => {
    const h = mount();
    await signIn(h);
    const emailsKey = [...soupKeys._def, 'company-email-list'];
    const companyKey = crmKeys.company('company').queryKey;
    h.client.setQueryData(emailsKey, ['previously visible thread']);
    h.client.setQueryData(companyKey, { id: 'company' });
    const updated = { ...settings, personal_domains: ['private.example'] };
    h.privacy.update.mockResolvedValue(ok(updated));
    h.privacy.get.mockResolvedValue(ok(updated));

    await h.source.update.mutateAsync({
      action: 'add_domain',
      scope: 'personal',
      domain: 'private.example',
    });

    expect(h.source.query.data?.personalDomains).toEqual(['private.example']);
    expect(h.client.getQueryState(emailsKey)?.isInvalidated).toBe(true);
    expect(h.client.getQueryState(companyKey)?.isInvalidated).toBe(true);
    expect(h.feedback.failure).not.toHaveBeenCalled();
  });

  it('refreshes maintained GraphQL CRM email readers after withdrawal', async () => {
    const h = mount();
    await signIn(h);
    const readers = [
      { body: { ecd: ['example.com'] }, refresh: vi.fn(async () => {}) },
      { body: { eca: ['person@example.com'] }, refresh: vi.fn(async () => {}) },
      { body: { crma: 'activity' }, refresh: vi.fn(async () => {}) },
      { body: { emailView: 'inbox' }, refresh: vi.fn(async () => {}) },
    ];
    for (const reader of readers) {
      cleanups.push(
        registerActiveGraphqlSoupQuery({
          isEnabled: () => true,
          cacheMaintained: () => true,
          body: () => reader.body,
          refresh: reader.refresh,
        })
      );
    }
    await h.source.update.mutateAsync({
      action: 'set_consent',
      enabled: false,
    });
    for (const reader of readers.slice(0, 3))
      expect(reader.refresh).toHaveBeenCalledOnce();
    expect(readers[3].refresh).not.toHaveBeenCalled();
  });

  it('keeps the confirmed sharing state and reports a failed withdrawal', async () => {
    const h = mount();
    await signIn(h);
    h.privacy.update.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'Could not reach the server' }])
    );
    await expect(
      h.source.update.mutateAsync({ action: 'set_consent', enabled: false })
    ).rejects.toThrow('Could not reach the server');

    expect(h.source.query.data?.enabled).toBe(true);
    expect(h.feedback.failure).toHaveBeenCalledWith(
      'Could not reach the server'
    );
  });

  it('does not replace another user’s settings when an earlier mutation finishes', async () => {
    const h = mount();
    await signIn(h);
    const response =
      Promise.withResolvers<Awaited<ReturnType<PrivacyClient['update']>>>();
    h.privacy.update.mockReturnValue(response.promise);
    const update = h.source.update.mutateAsync({
      action: 'set_consent',
      enabled: false,
    });
    await waitFor(() => expect(h.privacy.update).toHaveBeenCalledOnce());

    const other = { ...settings, mailbox_email: 'other@example.com' };
    h.privacy.get.mockResolvedValue(ok(other));
    h.setUser('other-user');
    await waitFor(() => {
      expect(h.source.query.isSuccess).toBe(true);
      expect(h.source.query.data?.mailboxEmail).toBe('other@example.com');
    });
    response.resolve(ok({ ...settings, enabled: false }));
    await update;

    expect(h.source.query.data?.enabled).toBe(true);
    expect(h.source.query.data?.mailboxEmail).toBe('other@example.com');
    expect(
      h.client.getQueryData<EmailPrivacy>(
        crmKeys.emailPrivacy('team', 'user').queryKey
      )?.enabled
    ).toBe(false);
  });
});

it('reads narrow consent and shares privacy updates without replacing full settings', async () => {
  const h = mount();
  await signIn(h);
  let consent!: ReturnType<typeof h.createConsent>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    consent = h.createConsent();
  });
  await waitFor(() => expect(consent.isSuccess).toBe(true));
  expect(h.privacy.getConsent).toHaveBeenCalledExactlyOnceWith(
    expect.any(AbortSignal)
  );
  expect(h.privacy.get).toHaveBeenCalledOnce();
  expect(consent.data).toEqual({
    enabled: true,
    mailboxEmail: 'person@example.com',
    mailboxLinkId: null,
  });
  expect(h.source.query.data?.teamDomains).toEqual([]);
  const withdrawn = { ...settings, enabled: false };
  h.privacy.update.mockResolvedValue(ok(withdrawn));
  h.privacy.get.mockResolvedValue(ok(withdrawn));
  h.privacy.getConsent.mockResolvedValue(ok(withdrawn));
  await h.source.update.mutateAsync({ action: 'set_consent', enabled: false });
  await waitFor(() => expect(consent.data?.enabled).toBe(false));
  const consentKey = crmKeys.emailConsent(
    'team',
    'user',
    currentQueryAccount()?.session
  ).queryKey;
  expect(h.client.getQueryData<EmailConsent>(consentKey)?.enabled).toBe(false);
  expect(h.source.query.data?.personalDomains).toEqual([]);
});

it('prevents an older consent read from replacing a confirmed privacy write', async () => {
  const h = mount();
  await signIn(h);
  const held =
    Promise.withResolvers<Awaited<ReturnType<PrivacyClient['getConsent']>>>();
  h.privacy.getConsent.mockReturnValueOnce(held.promise);
  let consent!: ReturnType<typeof h.createConsent>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    consent = h.createConsent();
  });
  await waitFor(() => expect(h.privacy.getConsent).toHaveBeenCalledOnce());
  const signal = h.privacy.getConsent.mock.calls[0][0];
  h.privacy.update.mockResolvedValue(ok({ ...settings, enabled: false }));
  await h.source.update.mutateAsync({
    action: 'set_thread_exclusion',
    thread_id: 'thread',
    excluded: false,
  });
  expect(signal?.aborted).toBe(true);
  held.resolve(ok(settings));
  await waitFor(() => expect(consent.data?.enabled).toBe(false));
  expect(h.privacy.getConsent).toHaveBeenCalledOnce();
});

it('cancels the narrow consent read when the signed-in session changes', async () => {
  const h = mount();
  await signIn(h);
  const key = crmKeys.emailConsent(
    'team',
    'user',
    currentQueryAccount()?.session
  ).queryKey;
  const held =
    Promise.withResolvers<Awaited<ReturnType<PrivacyClient['getConsent']>>>();
  h.privacy.getConsent.mockReturnValueOnce(held.promise);
  createRoot((dispose) => {
    cleanups.push(dispose);
    h.createConsent();
  });
  await waitFor(() => expect(h.privacy.getConsent).toHaveBeenCalledOnce());
  const signal = h.privacy.getConsent.mock.calls[0][0];
  await resetQueryAccountSession();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  held.resolve(ok(settings));
  expect(h.client.getQueryData(key)).toBeUndefined();
});

it('commits a thread exception through the shared privacy refresh and paginated source', async () => {
  const h = mount();
  await signIn(h);
  h.privacy.excludedThreads.mockResolvedValue(
    ok({
      threads: [
        {
          thread_id: 'thread',
          link_id: 'mailbox',
          subject: 'Private conversation',
        },
      ],
      next_cursor: 'thread',
    })
  );
  let nextPage!: ReturnType<typeof h.source.createExcludedThreads>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    nextPage = h.source.createExcludedThreads(() => 'cursor');
  });
  await waitFor(() => expect(nextPage.isSuccess).toBe(true));
  expect(h.privacy.excludedThreads).toHaveBeenCalledWith(
    'cursor',
    expect.any(AbortSignal),
    undefined
  );
  expect(nextPage.data?.threads[0].threadId).toBe('thread');
  const readers = [
    { body: { eca: ['person@example.com'] }, refresh: vi.fn(async () => {}) },
    { body: { ecd: ['example.com'] }, refresh: vi.fn(async () => {}) },
    {
      body: { crma: 'activity', emailView: 'all' },
      refresh: vi.fn(async () => {}),
    },
    { body: { emailView: 'inbox' }, refresh: vi.fn(async () => {}) },
    { body: { crma: 'activity' }, refresh: vi.fn(async () => {}) },
    {
      body: { crma: { company: 'company' }, emailView: 'all' },
      refresh: vi.fn(async () => {}),
    },
  ];
  for (const reader of readers) {
    cleanups.push(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        cacheMaintained: () => true,
        body: () => reader.body,
        refresh: reader.refresh,
      })
    );
  }
  const emailsKey = soupKeys.astItems({
    params: { limit: 100, sort_method: 'updated_at' },
    body: { ecd: ['example.com'] },
  }).queryKey;
  h.client.setQueryData(emailsKey, ['previously visible thread']);
  const unrelatedKeys = [
    [...soupKeys._def, 'ordinary-inbox'],
    crmKeys.company('company').queryKey,
    crmKeys.pipelines('team').queryKey,
    crmKeys.excludedEmailThreads('team', 'other-user', 1, undefined).queryKey,
  ];
  for (const key of unrelatedKeys) h.client.setQueryData(key, []);
  await h.source.update.mutateAsync({
    action: 'set_thread_exclusion',
    thread_id: 'thread',
    excluded: true,
  });
  expect(h.privacy.update).toHaveBeenCalledWith({
    action: 'set_thread_exclusion',
    thread_id: 'thread',
    excluded: true,
  });
  for (const reader of readers.slice(0, 2))
    expect(reader.refresh).toHaveBeenCalledOnce();
  for (const reader of readers.slice(2))
    expect(reader.refresh).not.toHaveBeenCalled();
  expect(h.client.getQueryState(emailsKey)?.isInvalidated).toBe(true);
  for (const key of unrelatedKeys)
    expect(h.client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(h.privacy.excludedThreads).toHaveBeenCalledTimes(2);
  expect(h.privacy.get).toHaveBeenCalledOnce();
});

it('keeps a restoration saved and refreshes exception pages when a contribution reader fails', async () => {
  const h = mount();
  await signIn(h);
  h.privacy.excludedThreads.mockResolvedValueOnce(
    ok({
      threads: [
        {
          thread_id: 'thread',
          link_id: 'mailbox',
          subject: 'Private conversation',
        },
      ],
      next_cursor: null,
    })
  );
  let list!: ReturnType<typeof h.source.createExcludedThreads>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    list = h.source.createExcludedThreads(() => undefined);
  });
  await waitFor(() => expect(list.data?.threads).toHaveLength(1));
  cleanups.push(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      cacheMaintained: () => true,
      body: () => ({ ecd: ['example.com'] }),
      refresh: async () => {
        throw new Error('Contribution refresh failed');
      },
    })
  );
  const emailsKey = soupKeys.astItems({
    params: { limit: 100, sort_method: 'updated_at' },
    body: { ecd: ['example.com'] },
  }).queryKey;
  h.client.setQueryData(emailsKey, ['previously visible thread']);

  await h.source.update.mutateAsync({
    action: 'set_thread_exclusion',
    thread_id: 'thread',
    excluded: false,
  });

  await waitFor(() => {
    expect(h.source.update.isSuccess).toBe(true);
    expect(list.data?.threads).toHaveLength(0);
  });
  expect(h.privacy.update).toHaveBeenCalledOnce();
  expect(h.privacy.excludedThreads).toHaveBeenCalledTimes(2);
  expect(h.client.getQueryState(emailsKey)?.isInvalidated).toBe(true);
  expect(h.feedback.failure).toHaveBeenCalledOnce();
});

it('looks up one thread and refreshes the header and settings list together', async () => {
  const h = mount();
  await signIn(h);
  let excluded = false;
  h.privacy.excludedThreads.mockImplementation(async () =>
    ok({
      threads: excluded
        ? [
            {
              thread_id: 'thread',
              link_id: 'mailbox',
              subject: 'Private subject',
            },
          ]
        : [],
      next_cursor: null,
    })
  );
  h.privacy.update.mockImplementation(async (change) => {
    if (change.action === 'set_thread_exclusion') excluded = change.excluded;
    return ok(settings);
  });
  let status!: ReturnType<typeof h.createStatus>;
  let list!: ReturnType<typeof h.source.createExcludedThreads>;
  const [threadId, setThreadId] = createSignal<string>();
  createRoot((dispose) => {
    cleanups.push(dispose);
    status = h.createStatus(threadId);
  });
  expect(h.privacy.excludedThreads).not.toHaveBeenCalled();
  setThreadId('thread');
  await waitFor(() => expect(status.isSuccess).toBe(true));
  expect(h.privacy.excludedThreads).toHaveBeenCalledExactlyOnceWith(
    undefined,
    expect.any(AbortSignal),
    'thread'
  );
  createRoot((dispose) => {
    cleanups.push(dispose);
    list = h.source.createExcludedThreads(() => undefined);
  });
  await waitFor(() => expect(list.isSuccess).toBe(true));
  for (const value of [true, false]) {
    await h.source.update.mutateAsync({
      action: 'set_thread_exclusion',
      thread_id: 'thread',
      excluded: value,
    });
    await waitFor(() => {
      expect(status.data?.threads).toHaveLength(value ? 1 : 0);
      expect(list.data?.threads).toHaveLength(value ? 1 : 0);
    });
  }
});

it('removes an exclusion while the header’s first status read is pending', async () => {
  const h = mount();
  await signIn(h);
  const previous = ok({
    threads: [
      {
        thread_id: 'thread',
        link_id: 'mailbox',
        subject: 'Private subject',
      },
    ],
    next_cursor: null,
  });
  const held =
    Promise.withResolvers<
      Awaited<ReturnType<PrivacyClient['excludedThreads']>>
    >();
  cleanups.push(() => held.resolve(previous));
  h.privacy.excludedThreads
    .mockResolvedValueOnce(previous)
    .mockReturnValueOnce(held.promise)
    .mockResolvedValue(ok({ threads: [], next_cursor: null }));
  let list!: ReturnType<typeof h.source.createExcludedThreads>;
  let status!: ReturnType<typeof h.createStatus>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    list = h.source.createExcludedThreads(() => undefined);
  });
  await waitFor(() => expect(list.data?.threads).toHaveLength(1));
  createRoot((dispose) => {
    cleanups.push(dispose);
    status = h.createStatus(() => 'thread');
  });
  await waitFor(() =>
    expect(h.privacy.excludedThreads).toHaveBeenCalledTimes(2)
  );
  const signal = h.privacy.excludedThreads.mock.calls[1][1];

  const removal = h.source.update.mutateAsync({
    action: 'set_thread_exclusion',
    thread_id: 'thread',
    excluded: false,
  });
  await waitFor(() => {
    expect(status.data?.threads).toEqual([]);
    expect(list.data?.threads).toEqual([]);
  });
  expect(signal?.aborted).toBe(true);
  held.resolve(previous);
  await removal;
  expect(status.data?.threads).toEqual([]);
  expect(list.data?.threads).toEqual([]);
  expect(h.feedback.failure).not.toHaveBeenCalled();
});

it('cancels a private-subject read across login and never caches it for the previous session', async () => {
  const h = mount();
  await signIn(h);
  const account = currentQueryAccount();
  const oldKey = crmKeys.excludedEmailThreads(
    'team',
    'user',
    account?.session,
    undefined
  ).queryKey;
  const held =
    Promise.withResolvers<
      Awaited<ReturnType<PrivacyClient['excludedThreads']>>
    >();
  h.privacy.excludedThreads.mockReturnValueOnce(held.promise).mockResolvedValue(
    ok({
      threads: [
        {
          thread_id: 'other-thread',
          link_id: 'other-mailbox',
          subject: 'Current private subject',
        },
      ],
      next_cursor: null,
    })
  );
  let list!: ReturnType<typeof h.source.createExcludedThreads>;
  createRoot((dispose) => {
    cleanups.push(dispose);
    list = h.source.createExcludedThreads(() => undefined);
  });
  await waitFor(() => expect(h.privacy.excludedThreads).toHaveBeenCalledOnce());
  const signal = h.privacy.excludedThreads.mock.calls[0][1];
  await resetQueryAccountSession();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  held.resolve(
    ok({
      threads: [
        {
          thread_id: 'late-thread',
          link_id: 'late-mailbox',
          subject: 'Late private subject',
        },
      ],
      next_cursor: null,
    })
  );
  await h.client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => ({ id: 'other-user', authenticated: true }),
  });
  h.setUser('other-user');
  await waitFor(() => expect(list.isSuccess).toBe(true));
  expect(list.data?.threads[0].subject).toBe('Current private subject');
  expect(h.client.getQueryData(oldKey)).toBeUndefined();
});
