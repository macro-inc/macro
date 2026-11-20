import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useQuickAccessCrmCompaniesQuery } from './crm-search';
import { createCrmUserCardAction } from './crm-user-action';
import { useQuickAccessCrmContactsQuery } from './record-adapter';

const state = vi.hoisted(() => ({
  allowed: (): boolean => true,
  companyOptions: undefined as (() => { enabled: boolean }) | undefined,
  contactOptions: undefined as (() => { enabled: boolean }) | undefined,
  lookupOptions: undefined as (() => { enabled: boolean }) | undefined,
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => state.allowed(),
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@queries/soup/items', () => ({
  useSoupItemsQuery: (_args: unknown, options: typeof state.companyOptions) => {
    state.companyOptions = options;
    return {
      isSuccess: true,
      data: [
        { id: 'company', type: 'crm_company', name: 'Company', hidden: false },
      ],
    };
  },
}));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQueryClient: () => ({}),
  queryOptions: (value: unknown) => value,
  infiniteQueryOptions: (value: unknown) => value,
  useMutation: vi.fn(),
  useQuery: (options: typeof state.lookupOptions) => {
    state.lookupOptions = options;
    return { isSuccess: true, data: { id: 'contact' } };
  },
  useInfiniteQuery: (options: typeof state.contactOptions) => {
    state.contactOptions = options;
    return {
      isPending: false,
      data: {
        pages: [
          {
            contacts: [
              { id: 'contact', crmContactName: 'Contact', hidden: false },
            ],
          },
        ],
      },
    };
  },
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team' } },
  }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/context/channels', () => ({
  useDmActivityByUserId: () => () => new Map(),
}));
vi.mock('@core/context/quickAccess/context', () => ({
  useQuickAccess: () => ({}),
}));

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('stops company and contact suggestion queries and conceals cached rows for denied members', () => {
  createRoot((cleanup) => {
    dispose = cleanup;
    const [allowed, setAllowed] = createSignal(false);
    state.allowed = allowed;
    const companies = useQuickAccessCrmCompaniesQuery();
    const contacts = useQuickAccessCrmContactsQuery();
    expect(state.companyOptions?.().enabled).toBe(false);
    expect(state.contactOptions?.().enabled).toBe(false);
    expect(companies.companies()).toEqual([]);
    expect(contacts.contacts()).toEqual([]);
    setAllowed(true);
    expect(companies.companies()).toHaveLength(1);
    expect(contacts.contacts()).toHaveLength(1);
    setAllowed(false);
    expect(companies.companies()).toEqual([]);
    expect(contacts.contacts()).toEqual([]);
  });
});

it('removes the user-card action and disables its contact lookup on live denial', () => {
  createRoot((cleanup) => {
    dispose = cleanup;
    const [allowed, setAllowed] = createSignal(true);
    state.allowed = allowed;
    const action = createCrmUserCardAction(() => 'person@example.com');
    expect(action()?.id).toBe('open-contact');
    expect(state.lookupOptions?.().enabled).toBe(true);
    setAllowed(false);
    expect(action()).toBeUndefined();
    expect(state.lookupOptions?.().enabled).toBe(false);
    setAllowed(true);
    expect(action()?.id).toBe('open-contact');
  });
});
