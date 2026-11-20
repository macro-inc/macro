import type { CrmCompanyEntity } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';
import { CompanyContactsSection } from './company-contacts-section';

const { openCreateContact, team } = vi.hoisted(() => ({
  openCreateContact: vi.fn(),
  team: {
    contacts: [] as CrmContact[],
    loadedSearch: '' as string | undefined,
  },
}));

vi.mock('../components/record-visibility-filter', () => ({
  RecordVisibilityFilter: () => null,
}));
vi.mock('../components/record-archived-status', () => ({
  ArchivedRecordBadge: () => null,
}));
vi.mock('@entity', () => ({
  ListEntity: (props: {
    entity: { name: string };
    icon: JSX.Element;
    titleTrailing: JSX.Element;
    onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  }) => (
    <button type="button" onClick={props.onClick}>
      {props.icon}
      {props.entity.name}
      {props.titleTrailing}
    </button>
  ),
  ListEntityMetadataQueryProvider: (props: ParentProps) => props.children,
  ListLayoutProvider: (props: ParentProps) => props.children,
}));
vi.mock('@ui', async () => ({
  ...(await import('../../../components/ui/components/Avatar')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  EmptyStatePanel: (props: {
    title?: string;
    primaryAction?: { label: string; onClick: () => void };
  }) => (
    <div>
      {props.title}
      {props.primaryAction && (
        <button type="button" onClick={props.primaryAction.onClick}>
          {props.primaryAction.label}
        </button>
      )}
    </div>
  ),
}));
vi.mock('@app/components/view-shell', () => ({
  SearchBar: (props: {
    label: string;
    value: string;
    onValueChange(value: string): void;
  }) => (
    <input
      aria-label={props.label}
      value={props.value}
      onInput={(event) => props.onValueChange(event.currentTarget.value)}
    />
  ),
}));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    userId: () => 'user-1',
    isTeamAdmin: () => () => true,
    openCreateContact,
    createNavigation: () => ({ openWithSplit: vi.fn() }),
    createContactPhoto: (email: string) => () =>
      email === 'avery@example.com' ? '/avery.jpg' : undefined,
    // The server's page; the section still narrows it by archive state and
    // the search typed before the debounced read.
    createCompanyContactsSource: () => ({
      get contacts() {
        return team.contacts;
      },
      isPending: false,
      get loadedSearch() {
        return team.loadedSearch;
      },
      isSearching: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: async () => undefined,
      refetch: async () => undefined,
    }),
  }),
}));
afterEach(() => {
  cleanup();
  team.contacts = [];
  team.loadedSearch = '';
  vi.clearAllMocks();
});

const contacts: CrmContact[] = [
  {
    id: 'a',
    companyId: 'co',
    name: 'Avery Chen',
    email: 'avery@example.com',
    hidden: false,
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
    firstInteraction: '2026-10-15',
    lastInteraction: '2026-10-15',
  },
  {
    id: 'p',
    companyId: 'co',
    email: 'procurement@example.com',
    hidden: false,
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
    firstInteraction: '2026-10-15',
    lastInteraction: '2026-10-15',
  },
];

it('opens contact creation for a company with no domain from either action', () => {
  render(() => (
    <CompanyContactsSection
      company={{
        id: 'co',
        type: 'crm_company',
        name: 'Community group',
        ownerId: 'owner',
        teamId: 'team',
        hidden: false,
        domains: [],
      }}
    />
  ));
  const actions = screen.getAllByRole('button', { name: 'Add contact' });
  expect(actions).toHaveLength(2);
  for (const action of actions) {
    expect(action.hasAttribute('disabled')).toBe(false);
    fireEvent.click(action);
  }
  expect(openCreateContact).toHaveBeenCalledTimes(2);
  expect(openCreateContact).toHaveBeenLastCalledWith({ companyId: 'co' });
});

it('shows contact photos or a letter avatar and opens the chosen contact', () => {
  team.contacts = contacts;
  const open = vi.fn();
  const { container } = render(() => (
    <CompanyContactsSection
      company={{ id: 'co' } as CrmCompanyEntity}
      onOpenContact={open}
    />
  ));
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    '/avery.jpg'
  );
  screen.getByText('P');
  fireEvent.click(screen.getByRole('button', { name: /Avery Chen/ }));
  expect(open).toHaveBeenCalledWith(contacts[0]);
});

it('filters by email and keeps the search available with no results', () => {
  team.contacts = contacts;
  render(() => (
    <CompanyContactsSection company={{ id: 'co' } as CrmCompanyEntity} />
  ));
  const search = screen.getByRole('textbox', { name: 'Search team' });
  fireEvent.input(search, { target: { value: 'procurement' } });
  expect(screen.queryByRole('button', { name: /Avery Chen/ })).toBeNull();
  screen.getByRole('button', { name: /procurement@example.com/ });
  fireEvent.input(search, { target: { value: 'missing' } });
  screen.getByText('No matching contacts.');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  screen.getByRole('button', { name: /Avery Chen/ });
  expect(screen.getByRole('textbox', { name: 'Search team' })).toBe(search);
});

it('excludes hidden contacts from an admin response, including search matches', () => {
  const removed = {
    ...contacts[0],
    id: 'removed',
    hidden: true,
    name: 'Removed person',
  };
  const response = [...contacts, removed];
  team.contacts = response;
  render(() => (
    <CompanyContactsSection company={{ id: 'co' } as CrmCompanyEntity} />
  ));
  screen.getByRole('button', { name: /Avery Chen/ });
  expect(screen.queryByRole('button', { name: /Removed person/ })).toBeNull();
  fireEvent.input(screen.getByRole('textbox', { name: 'Search team' }), {
    target: { value: 'Removed person' },
  });
  screen.getByText('No matching contacts.');
  // Presentation must preserve the record for authorized detail/restore access.
  expect(response).toContain(removed);
  expect(removed.companyId).toBe('co');
});

it('shows the rows the server matched for the typed search, narrowing only an earlier search', () => {
  // Postgres folds 'İ' to 'i'; JavaScript folds it to 'i̇', which
  // 'istanbul' does not contain.
  team.contacts = [
    {
      ...contacts[0],
      id: 'o',
      name: 'Istanbul office',
      email: 'o@example.com',
    },
  ];
  const typeSearch = () =>
    fireEvent.input(screen.getByRole('textbox', { name: 'Search team' }), {
      target: { value: ' İstanbul ' },
    });

  // Rows of the empty search wait for the server, narrowed here.
  render(() => (
    <CompanyContactsSection company={{ id: 'co' } as CrmCompanyEntity} />
  ));
  typeSearch();
  expect(screen.queryByRole('button', { name: /Istanbul office/ })).toBeNull();
  cleanup();

  // The server's answer to this search is shown as it came.
  team.loadedSearch = 'İstanbul';
  render(() => (
    <CompanyContactsSection company={{ id: 'co' } as CrmCompanyEntity} />
  ));
  typeSearch();
  screen.getByRole('button', { name: /Istanbul office/ });
});
