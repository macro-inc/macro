import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import type {
  CrmEmailPrivacyResponse,
  crmEmailPrivacyClient,
} from '@service-storage/crm-email-privacy';
import { waitFor } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailPrivacy } from '../core/email-privacy';
import { createEmailPrivacySource } from './email-privacy';
import { crmKeys } from './keys';

type PrivacyClient = typeof crmEmailPrivacyClient;

const settings: CrmEmailPrivacyResponse = {
  enabled: true,
  mailbox_email: 'person@example.com',
  team_domains: [],
  personal_domains: [],
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
    cleanups.push(() => {
      dispose();
      client.clear();
    });
    const privacy = {
      get: vi
        .fn<PrivacyClient['get']>()
        .mockResolvedValue(ok({ ...settings, ...initial })),
      update: vi.fn<PrivacyClient['update']>().mockResolvedValue(ok(settings)),
    };
    const feedback = { success: vi.fn(), failure: vi.fn() };
    const [team, setTeam] = createSignal<string>();
    const [user, setUser] = createSignal<string>();
    const source = createEmailPrivacySource(
      { client, privacy, feedback },
      team,
      user
    );
    return { source, client, privacy, feedback, setTeam, setUser };
  });
}

async function signIn(h: ReturnType<typeof mount>) {
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
