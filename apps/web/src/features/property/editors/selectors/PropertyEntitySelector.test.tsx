import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  emailBrowse: [] as boolean[],
  emailSearch: [] as boolean[],
  pinnedPeople: [] as boolean[],
  contactSearches: [] as string[],
  contactSearchDisabled: false,
  contactCopies: [] as ReturnType<typeof contactItem>[],
  contactError: undefined as Error | undefined,
  contactRetries: 0,
  companySearches: [] as string[],
  companyError: undefined as Error | undefined,
  companyRetries: 0,
  addCompanyPage: undefined as (() => void) | undefined,
}));

function companyEntity(id: string, name: string, domain: string) {
  return {
    type: 'crm_company',
    id,
    name,
    hidden: false,
    domains: [{ id: `${id}-domain`, companyId: id, domain }],
  };
}

function contactItem(
  id: string,
  name: string,
  email: string,
  sortTimestamp = 0
) {
  return {
    kind: 'entity',
    id,
    bucket: 'crm_contact',
    searchText: `${name} | ${email}`,
    sortTimestamp,
    timestamps: {},
    data: { type: 'crm_contact', id, name, email, hidden: false },
  };
}

// The search service matches companies Quick Access does not hold.
vi.mock('@app/features/crm/crm-search', async () => {
  const { createSignal } =
    await vi.importActual<typeof import('solid-js')>('solid-js');
  return {
    useCrmCompanySearchSource: (
      search: () => string,
      enabled: () => boolean
    ) => {
      const [pages, setPages] = createSignal(1);
      sources.addCompanyPage = () => setPages((count) => count + 1);
      return {
        companies: () => {
          if (!enabled()) return [];
          sources.companySearches.push(search());
          const loaded = [
            companyEntity(
              'company-old',
              'Northwind Traders',
              'northwind.example.com'
            ),
            ...(pages() > 1
              ? [
                  companyEntity(
                    'company-later',
                    'Northwind Logistics',
                    'northwind-logistics.example.com'
                  ),
                ]
              : []),
          ];
          return loaded.filter((company) =>
            `${company.name} | ${company.domains[0]?.domain}`
              .toLowerCase()
              .includes(search().toLowerCase())
          );
        },
        hasMore: () => false,
        isLoading: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
        error: () => sources.companyError,
        retry: async () => {
          sources.companyRetries += 1;
        },
      };
    },
  };
});
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: sources.contactSearchDisabled }),
}));
// The server's CRM contact search finds contacts Quick Access does not hold.
vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactMentionSource: (
    search: () => string,
    enabled: () => boolean
  ) => {
    const matches = () => {
      if (!enabled()) return [];
      sources.contactSearches.push(search());
      return 'northwind support | support@northwind.example.com'.includes(
        search().toLowerCase()
      )
        ? [
            contactItem(
              'contact-old',
              'Northwind Support',
              'support@northwind.example.com',
              10
            ),
          ]
        : [];
    };
    return {
      entities: matches,
      hasMore: () => false,
      isLoading: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
      error: () => sources.contactError,
      retry: async () => {
        sources.contactRetries += 1;
      },
    };
  },
}));

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'alice@example.com',
  useUserId: () => () => 'macro|alice@example.com',
}));
vi.mock('@core/user', () => ({
  emailToId: (email: string) => `macro|${email}`,
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@queries/contacts/use-directory', () => ({
  usePinnedContactUsers: (_selected: unknown, enabled: () => boolean) => () => {
    sources.pinnedPeople.push(enabled());
    return enabled()
      ? [{ id: 'macro|pat@example.com', name: 'Pat', email: 'pat@example.com' }]
      : [];
  },
}));
// Quick Access holds the task; threads come from email's own browse list.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    isLoading: () => false,
    useList: (options: { buckets: string[] }) => ({
      isLoading: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      error: () => undefined,
      windowKey: () => undefined,
      loadMore: async () => {},
      items: () =>
        options.buckets.includes('crm_company')
          ? [
              {
                kind: 'entity',
                id: 'company-recent',
                bucket: 'crm_company',
                searchText: 'Initech | initech.example.com',
                sortTimestamp: 0,
                timestamps: {},
                data: companyEntity(
                  'company-recent',
                  'Initech',
                  'initech.example.com'
                ),
              },
            ]
          : options.buckets.includes('crm_contact')
            ? [
                contactItem('contact-recent', 'Ada Recent', 'ada@example.com'),
                ...sources.contactCopies,
              ]
            : options.buckets.includes('task')
              ? [
                  {
                    kind: 'task',
                    id: 'task-1',
                    data: {
                      type: 'document',
                      id: 'task-1',
                      name: 'Ship it',
                      subType: { type: 'task' },
                    },
                  },
                ]
              : [],
    }),
  }),
}));
vi.mock('@entity', () => ({
  Entity: {
    Icon: () => <span />,
    Title: (props: { entity: { name: string } }) => (
      <span>{props.entity.name}</span>
    ),
  },
  createEmailsInfiniteQuery: (
    _params: unknown,
    options: { disabled: () => boolean }
  ) => {
    sources.emailBrowse.push(!options.disabled());
    return {
      get data() {
        return options.disabled()
          ? []
          : [{ type: 'email', id: 'thread-1', name: 'Quarterly invoice' }];
      },
      isLoading: false,
      isPending: false,
    };
  },
}));
vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: (text: string) => text.length > 0,
  useSearchSoupQuery: (
    _request: unknown,
    options: () => { enabled: boolean }
  ) => {
    sources.emailSearch.push(options().enabled);
    return {
      get status() {
        return options().enabled ? 'success' : 'pending';
      },
      get data() {
        return options().enabled
          ? [{ type: 'email', id: 'thread-2', name: 'Invoice overdue' }]
          : undefined;
      },
      isFetching: false,
    };
  },
}));
vi.mock('@property/utils', () => ({ useSearchInputFocus: () => undefined }));

import { PropertyEntitySelector } from './PropertyEntitySelector';

afterEach(() => {
  cleanup();
  sources.emailBrowse.length = 0;
  sources.emailSearch.length = 0;
  sources.pinnedPeople.length = 0;
  sources.contactSearches.length = 0;
  sources.contactSearchDisabled = false;
  sources.contactCopies.length = 0;
  sources.contactError = undefined;
  sources.contactRetries = 0;
  sources.companySearches.length = 0;
  sources.companyError = undefined;
  sources.companyRetries = 0;
  sources.addCompanyPage = undefined;
});

function renderSelector(
  specificEntityType: EntityType | EntityType[],
  excludedIds: string[] = []
) {
  render(() => (
    <PropertyEntitySelector
      config={{
        isMultiSelect: false,
        specificEntityType,
        placeholder: 'Find',
        excludedIds: () => new Set(excludedIds),
      }}
      selectedOptions={() => new Set()}
      setSelectedOptions={() => {}}
    />
  ));
}

describe('an entity selector limited to several kinds', () => {
  it('browses and searches email threads when they are one of them', async () => {
    renderSelector(['TASK', 'THREAD']);
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.getByText('Quarterly invoice')).toBeTruthy();
    expect(sources.emailBrowse).toContain(true);
    expect(sources.emailSearch).toContain(true);

    fireEvent.input(screen.getByPlaceholderText('Find'), {
      target: { value: 'invoice' },
    });
    await waitFor(() =>
      expect(screen.getByText('Invoice overdue')).toBeTruthy()
    );
  });

  it('leaves email alone when threads are not among them', async () => {
    renderSelector(['TASK', 'CHANNEL']);
    expect(await screen.findByText('Ship it')).toBeTruthy();
    expect(screen.queryByText('Quarterly invoice')).toBeNull();
    expect(sources.emailBrowse).not.toContain(true);
    expect(sources.emailSearch).not.toContain(true);
  });

  it('offers pinned people when people are one of them', async () => {
    renderSelector(['TASK', 'USER']);
    expect(await screen.findByText('Pat')).toBeTruthy();
    expect(sources.pinnedPeople).toContain(true);
  });
});

describe('a contact selector', () => {
  const type = (value: string) =>
    fireEvent.input(screen.getByPlaceholderText('Find'), {
      target: { value },
    });

  it('lists recent contacts without searching the server', async () => {
    renderSelector('CONTACT');
    expect(await screen.findByText('Ada Recent')).toBeTruthy();
    expect(sources.contactSearches).toEqual([]);
  });

  it('finds a contact Quick Access does not hold by email, part of it, or name', async () => {
    renderSelector('CONTACT');
    await screen.findByText('Ada Recent');
    for (const query of [
      'support@northwind.example.com',
      'support@north',
      'northwind.example.com',
      'Northwind',
    ]) {
      type(query);
      expect(await screen.findByText('Northwind Support')).toBeTruthy();
      expect(screen.queryByText('No contacts found')).toBeNull();
    }
    expect(sources.contactSearches).toContain('support@northwind.example.com');
  });

  it('keeps an eligible record when an excluded one shares its email', async () => {
    sources.contactCopies.push(
      contactItem(
        'contact-copy',
        'Northwind Support',
        'support@northwind.example.com'
      )
    );
    renderSelector('CONTACT', ['contact-old']);
    await screen.findByText('Ada Recent');
    type('support@northwind.example.com');
    await waitFor(() =>
      expect(sources.contactSearches).toContain('support@northwind.example.com')
    );
    expect(await screen.findByText('Northwind Support')).toBeTruthy();
  });

  it('offers Retry when a server contact page fails', async () => {
    sources.contactError = new Error('contact page failed');
    renderSelector('CONTACT');
    await screen.findByText('Ada Recent');
    type('northwind');
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(sources.contactRetries).toBe(1));
  });

  it('leaves the server alone when contact search is switched off', async () => {
    sources.contactSearchDisabled = true;
    renderSelector('CONTACT');
    await screen.findByText('Ada Recent');
    type('support@northwind.example.com');
    expect(await screen.findByText('No contacts found')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText('Northwind Support')).toBeNull();
    expect(sources.contactSearches).toEqual([]);
  });
});

describe('a company selector', () => {
  const type = (value: string) =>
    fireEvent.input(screen.getByPlaceholderText('Find'), {
      target: { value },
    });

  it('lists recent companies without searching the server', async () => {
    renderSelector('COMPANY');
    expect(await screen.findByText('Initech')).toBeTruthy();
    expect(sources.companySearches).toEqual([]);
  });

  it('finds a company Quick Access does not hold by name or domain', async () => {
    renderSelector('COMPANY');
    await screen.findByText('Initech');
    for (const query of ['Northwind', 'northwind.example.com', 'wind.exa']) {
      type(query);
      await waitFor(() =>
        expect(sources.companySearches).toContain(query.toLowerCase())
      );
      expect(await screen.findByText('Northwind Traders')).toBeTruthy();
      expect(screen.queryByText('No companies found')).toBeNull();
    }
  });

  it('finds a recent company by its domain', async () => {
    renderSelector('COMPANY');
    await screen.findByText('Initech');
    type('initech.example');
    await waitFor(() =>
      expect(sources.companySearches).toContain('initech.example')
    );
    expect(screen.getByText('Initech')).toBeTruthy();
  });

  it('keeps listed server rows mounted when another page arrives', async () => {
    renderSelector('COMPANY');
    await screen.findByText('Initech');
    type('northwind');
    const row = (await screen.findByText('Northwind Traders')).closest(
      '[data-entity-index]'
    );
    sources.addCompanyPage?.();
    expect(await screen.findByText('Northwind Logistics')).toBeTruthy();
    expect(row?.isConnected).toBe(true);
  });

  it('offers Retry when a server company page fails', async () => {
    sources.companyError = new Error('company page failed');
    renderSelector('COMPANY');
    await screen.findByText('Initech');
    type('northwind');
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(sources.companyRetries).toBe(1));
  });
});
