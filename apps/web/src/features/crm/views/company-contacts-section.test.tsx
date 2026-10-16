import type { CrmCompanyEntity } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';
import { CompanyContactsSection } from './company-contacts-section';

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
vi.mock('@ui', async () => import('../../../components/ui/components/Avatar'));
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
    createNavigation: () => ({ openWithSplit: vi.fn() }),
    createContactPhoto: (email: string) => () =>
      email === 'avery@example.com' ? '/avery.jpg' : undefined,
  }),
}));
afterEach(cleanup);

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

it('shows contact photos or a letter avatar and opens the chosen contact', () => {
  const open = vi.fn();
  const { container } = render(() => (
    <CompanyContactsSection
      company={{ id: 'co' } as CrmCompanyEntity}
      contacts={contacts}
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
  render(() => (
    <CompanyContactsSection
      company={{ id: 'co' } as CrmCompanyEntity}
      contacts={contacts}
    />
  ));
  const search = screen.getByRole('textbox', { name: 'Search team' });
  fireEvent.input(search, { target: { value: 'procurement' } });
  expect(screen.queryByRole('button', { name: /Avery Chen/ })).toBeNull();
  screen.getByRole('button', { name: /procurement@example.com/ });
  fireEvent.input(search, { target: { value: 'missing' } });
  screen.getByText('No matching contacts.');
  expect(screen.getByRole('textbox', { name: 'Search team' })).toBe(search);
});
