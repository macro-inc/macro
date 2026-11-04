import { storageServiceClient } from '@service-storage/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { createSignal, type JSX, type ParentProps, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanyOption } from '../components/company-select';
import { useBlockedDomains } from '../queries/blocked-domains';
import { EmailSyncSection } from './email-sync-settings';

const state = vi.hoisted(() => ({
  domains: ['example.com', 'example.org'],
  blocked: new Set<string>(),
  block: vi.fn(),
  companyVisible: (): boolean => true,
  setCompanyVisible: (_value: boolean) => {},
  latestMutationPending: (): boolean => false,
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    listCrmBlockedDomains: async () =>
      ok([...state.blocked].map((domain) => ({ domain }))),
    blockCrmDomain: state.block,
    unblockCrmDomain: vi.fn(),
  },
}));
vi.mock('@service-storage/crm-contacts', () => ({
  invalidateCachedCrmCompanies: async () => {},
  invalidateCachedCrmContacts: async () => {},
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: async () => {},
}));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({ feedback: { failure: vi.fn() } }),
}));
vi.mock('./use-crm', () => ({
  useBlockedDomains: () => {
    const source = useBlockedDomains({
      client,
      storage: storageServiceClient,
      feedback: { success: () => {}, failure: () => {} },
    });
    state.latestMutationPending = () => source.setBlocked.isPending;
    return source;
  },
  useIsTeamAdmin: () => () => true,
  useTeamCrmConfig: () => ({
    config: () => ({ excludePersonalEmails: true }),
    isLoading: () => false,
    update: { isPending: false, mutate: vi.fn() },
  }),
  useQuickAccessCrmCompaniesQuery: () => ({
    companies: () =>
      state.companyVisible()
        ? [
            {
              id: 'company-1',
              name: 'Example Company',
              domains: state.domains.map((domain) => ({ domain })),
            },
          ]
        : [],
    query: { isLoading: false },
  }),
}));
vi.mock('../components/company-select', () => ({
  CompanySelect: (props: {
    companies: CompanyOption[];
    disabled?: boolean;
    onChange(company: CompanyOption): void;
  }) => (
    <button
      disabled={props.disabled}
      onClick={() => {
        const company = props.companies[0];
        if (company) props.onChange(company);
      }}
    >
      Choose a company
    </button>
  ),
}));
vi.mock('../../settings/primitives', () => ({
  SettingsCard: (props: ParentProps) => <div>{props.children}</div>,
  SettingsSection: (props: ParentProps) => <div>{props.children}</div>,
  SettingsRow: (props: ParentProps) => <div>{props.children}</div>,
}));
vi.mock('@app/components/view-shell/ListSkeleton', () => ({
  ListSkeleton: { Bar: () => null },
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  ToggleSwitch: () => null,
  Tooltip: (props: ParentProps) => <>{props.children}</>,
}));

let client: QueryClient;
beforeEach(() => {
  state.domains = ['example.com', 'example.org'];
  state.blocked.clear();
  [state.companyVisible, state.setCompanyVisible] = createSignal(true);
  state.block.mockReset().mockImplementation(async ({ domain }) => {
    state.blocked.add(domain);
    state.setCompanyVisible(false);
    return ok(undefined);
  });
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

async function chooseCompany(draft?: string) {
  render(() => (
    <Suspense>
      <EmailSyncSection />
    </Suspense>
  ));
  const picker = await screen.findByRole('button', {
    name: 'Choose a company',
  });
  if (draft) {
    fireEvent.input(screen.getByRole('textbox', { name: 'Domain to block' }), {
      target: { value: draft },
    });
  }
  fireEvent.click(picker);
  return picker as HTMLButtonElement;
}

it('keeps a failed domain available for retry after the company disappears', async () => {
  state.block.mockImplementation(async ({ domain }) => {
    if (domain === 'example.com') return err(new Error('Unavailable'));
    state.blocked.add(domain);
    state.setCompanyVisible(false);
    return ok(undefined);
  });
  await chooseCompany();
  await screen.findByRole('button', { name: 'Unblock example.org' });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'example.com'
  );
  expect(state.companyVisible()).toBe(false);

  state.block.mockImplementation(async ({ domain }) => {
    state.blocked.add(domain);
    return ok(undefined);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed domains' }));
  await screen.findByRole('button', { name: 'Unblock example.com' });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(state.block.mock.calls.map(([input]) => input.domain)).toEqual([
    'example.com',
    'example.org',
    'example.com',
  ]);
});

it('keeps every conflicting control disabled until all domain requests settle', async () => {
  const first = Promise.withResolvers<Result<void, Error>>();
  state.block.mockImplementation(async ({ domain }) => {
    if (domain === 'example.com') return first.promise;
    state.blocked.add(domain);
    state.setCompanyVisible(false);
    return ok(undefined);
  });
  const picker = await chooseCompany('example.net');
  const unblock = (await screen.findByRole('button', {
    name: 'Unblock example.org',
  })) as HTMLButtonElement;
  const input = screen.getByRole('textbox', {
    name: 'Domain to block',
  }) as HTMLInputElement;
  const block = screen.getByRole('button', {
    name: /^Block$/,
  }) as HTMLButtonElement;
  await waitFor(() => expect(state.latestMutationPending()).toBe(false));
  const disabledWhileFirstPending = [
    picker.disabled,
    unblock.disabled,
    input.disabled,
    block.disabled,
  ];
  state.blocked.add('example.com');
  first.resolve(ok(undefined));
  await screen.findByRole('button', { name: 'Unblock example.com' });
  await waitFor(() => expect(picker.disabled).toBe(false));
  expect(disabledWhileFirstPending).toEqual([true, true, true, true]);
});

it('snapshots and deduplicates company domains before successful blocks hide it', async () => {
  state.domains = ['EXAMPLE.COM', 'example.com', 'example.org'];
  await chooseCompany();
  await screen.findByRole('button', { name: 'Unblock example.org' });
  expect(state.block.mock.calls.map(([input]) => input.domain)).toEqual([
    'example.com',
    'example.org',
  ]);
});
