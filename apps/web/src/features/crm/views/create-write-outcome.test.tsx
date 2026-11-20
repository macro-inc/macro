import { safeFetch } from '@core/util/safeFetch';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmRecordDependencies } from '../queries/dependencies';

const fixtures = vi.hoisted(() => ({
  proof: vi.fn(),
  retire: vi.fn(),
  refetch: vi.fn(),
  deps: undefined as CrmRecordDependencies | undefined,
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: {
    'document-storage-service': 'http://localhost/dss',
    'email-service': 'http://localhost/email',
    'agent-harness': 'http://localhost/agent',
  },
  SYNC_SERVICE_HOSTS: { worker: 'http://localhost/sync' },
  NATIVE_SESSION_SERVICE_URLS: [],
}));
vi.mock('@service-storage/client', () => ({ dssFetch: fixtures.proof }));
vi.mock('@service-auth/client', () => ({ authServiceClient: {} }));
vi.mock('@queries/client', () => ({
  queryPersistence: { retire: fixtures.retire },
  queryClient: {
    refetchQueries: fixtures.refetch,
    cancelQueries: async () => {},
  },
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmContacts: vi.fn(),
}));
vi.mock('./use-crm', async () => {
  const queries = await import('../queries/companies');
  return {
    useCreateCompanyMutation: () =>
      queries.useCreateCompanyMutation(fixtures.deps!),
    useCreateContactMutation: () =>
      queries.useCreateContactMutation(fixtures.deps!),
    useCompanyQuery: () => ({
      query: { isError: false },
      company: () => undefined,
    }),
    useContactQuery: () => ({ isSuccess: false, isError: false }),
    useQuickAccessCrmCompaniesQuery: () => ({
      companies: () => [],
      query: { isLoading: false },
    }),
  };
});
vi.mock('../context/crm-context', async () => {
  const { crmAccessAuthority } = await import(
    '@service-storage/crm-access-authority'
  );
  return {
    useCrmContext: () => ({
      canAccess: crmAccessAuthority.allowed,
      accessState: crmAccessAuthority.state,
      retryAccess: crmAccessAuthority.refresh,
      registerTaskComposerRecord: () => () => {},
    }),
  };
});

import { crmAccessAuthority } from '@service-storage/crm-access-authority';
import {
  installCrmCacheHost,
  setCrmAccessSession,
} from '@service-storage/crm-access-cache';
import { crmKeys } from '../queries/keys';
import { CreateCompanyModal } from './create-company';
import { CreateContactModal } from './create-contact';

const team = '00000000-0000-4000-8000-000000000001';
let client: QueryClient;
let motionStyles: HTMLStyleElement;
beforeEach(async () => {
  fixtures.proof
    .mockReset()
    .mockResolvedValue(ok({ team_id: team, allowed: true }));
  fixtures.retire.mockResolvedValue(undefined);
  fixtures.refetch.mockResolvedValue(undefined);
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom does not load the app CSS; use the same motion defaults as Dialog tests.
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  installCrmCacheHost(undefined);
  setCrmAccessSession('viewer');
  await crmAccessAuthority.refresh();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const create = (path: string, input: unknown) =>
    safeFetch<{ id: string }>(`http://localhost/dss${path}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  fixtures.deps = {
    client,
    storage: {
      createCompany: (input: unknown) => create('/crm/companies', input),
      createContact: (input: unknown) => create('/crm/contacts', input),
    },
  } as unknown as CrmRecordDependencies;
});
afterEach(async () => {
  cleanup();
  motionStyles.remove();
  client.clear();
  setCrmAccessSession(undefined);
  await cacheSessionGeneration.transition(async () => {});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ['company', 'unavailable'],
  ['company', 'revoked'],
  ['contact', 'unavailable'],
  ['contact', 'revoked'],
] as const)(
  'keeps a committed %s create successful when post-response proof is %s',
  async (kind, proofState) => {
    const reply = Promise.withResolvers<Response>();
    const fetch = vi.fn(() => reply.promise);
    vi.stubGlobal('fetch', fetch);
    const created = vi.fn();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <>
        <Show
          when={kind === 'company'}
          fallback={
            <CreateContactModal
              target={
                open() ? { company: { companyId: 'open-company' } } : undefined
              }
              onClose={() => setOpen(false)}
              onCreated={created}
            />
          }
        >
          <CreateCompanyModal
            open={open()}
            onClose={() => setOpen(false)}
            onCreated={created}
          />
        </Show>
      </>
    ));
    fireEvent.input(
      screen.getByRole('textbox', {
        name: kind === 'company' ? 'Company name' : 'Contact name',
      }),
      { target: { value: 'Created once' } }
    );
    const form = screen.getByRole('form', {
      name: kind === 'company' ? 'New company' : 'New contact',
    });
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fixtures.proof.mockClear();
    // A second submit while the actual write is pending must not dispatch again.
    fireEvent.submit(form);
    fixtures.proof.mockResolvedValue(
      proofState === 'revoked'
        ? ok({ team_id: team, allowed: false })
        : err(new Error('Proof unavailable'))
    );
    reply.resolve(
      Response.json(
        { id: `${kind}-created`, name: 'Created once' },
        {
          status: 201,
          headers: { 'x-macro-crm-access': `${team}:denied` },
        }
      )
    );
    await waitFor(() =>
      expect(created).toHaveBeenCalledExactlyOnceWith(`${kind}-created`)
    );
    await waitFor(() => expect(fixtures.proof).toHaveBeenCalled());
    expect(screen.queryByText(/Try again/i)).toBeNull();
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(open()).toBe(false);
    if (proofState === 'revoked') {
      await waitFor(() => expect(crmAccessAuthority.state()).toBe('denied'));
    } else {
      expect(crmAccessAuthority.state()).toBe('allowed');
    }
    const cached = client.getQueryData(
      (kind === 'company' ? crmKeys.company : crmKeys.contact)(
        `${kind}-created`
      ).queryKey
    );
    if (kind === 'company' && proofState !== 'revoked') {
      // A transient lookup failure leaves the proven generation current, so
      // the successfully created company's detail can still be seeded.
      expect(cached).toEqual({ id: 'company-created', name: 'Created once' });
    } else {
      expect(cached).toBeUndefined();
    }
    // Even a stale form event cannot resubmit the cleared input after success.
    fireEvent.submit(form);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
  }
);
