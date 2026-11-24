import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';

const state = vi.hoisted(() => ({
  companyReads: [] as string[],
  /** Whether another split shows the company. */
  shownElsewhere: false,
  openWithSplit: vi.fn(),
}));

vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    createNavigation: () => ({
      openWithSplit: state.openWithSplit,
      showsElsewhere: () => state.shownElsewhere,
    }),
    editContactCompany: () => ({ mutateAsync: vi.fn() }),
  }),
}));
vi.mock('./use-crm', () => ({
  useCompanyQuery: (id: () => string) => ({
    company: () => {
      const companyId = id();
      if (!companyId) return undefined;
      state.companyReads.push(companyId);
      return { id: companyId, name: 'Read company' };
    },
  }),
}));
vi.mock('../components/contact-company-property', () => ({
  ContactCompanyProperty: (props: {
    companyName?: string;
    openCompany: { onClick(event: MouseEvent): void };
  }) => (
    <button type="button" onClick={(event) => props.openCompany.onClick(event)}>
      {props.companyName ?? 'no company name'}
    </button>
  ),
}));

import { ContactCompanyField } from './contact-properties';

afterEach(() => {
  cleanup();
  state.companyReads = [];
  state.shownElsewhere = false;
  state.openWithSplit.mockReset();
});

function contact(company?: CrmContact['company']): CrmContact {
  return {
    id: 'contact-1',
    companyId: 'company-1',
    company,
    hidden: false,
    firstInteraction: '',
    lastInteraction: '',
    createdAt: '',
    updatedAt: '',
  };
}

it('names the company from the contact detail without reading it', () => {
  render(() => (
    <ContactCompanyField
      surface="header"
      contact={contact({ id: 'company-1', name: 'Acme', hidden: false })}
    />
  ));
  expect(screen.getByText('Acme')).toBeTruthy();
  expect(state.companyReads).toEqual([]);
});

it('names an unnamed company by its domain', () => {
  render(() => (
    <ContactCompanyField
      surface="header"
      contact={contact({
        id: 'company-1',
        name: null,
        domain: 'acme.com',
        hidden: false,
      })}
    />
  ));
  expect(screen.getByText('acme.com')).toBeTruthy();
  expect(state.companyReads).toEqual([]);
});

it('reads the company for a detail without a summary', () => {
  render(() => <ContactCompanyField surface="header" contact={contact()} />);
  expect(screen.getByText('Read company')).toBeTruthy();
  expect(state.companyReads).toContain('company-1');
});

it('brings forward a split already showing the company on Shift-click, as on a plain click', () => {
  state.shownElsewhere = true;
  const onOpenCompany = vi.fn(() => true);
  render(() => (
    <ContactCompanyField
      surface="header"
      contact={contact({ id: 'company-1', name: 'Acme', hidden: false })}
      onOpenCompany={onOpenCompany}
    />
  ));
  fireEvent.click(screen.getByText('Acme'), { shiftKey: true });
  expect(onOpenCompany).toHaveBeenCalledWith('company-1');
  expect(state.openWithSplit).not.toHaveBeenCalled();
});

it('opens a new split on Shift-click when no other split shows the company', () => {
  const onOpenCompany = vi.fn(() => true);
  render(() => (
    <ContactCompanyField
      surface="header"
      contact={contact({ id: 'company-1', name: 'Acme', hidden: false })}
      onOpenCompany={onOpenCompany}
    />
  ));
  fireEvent.click(screen.getByText('Acme'), { shiftKey: true });
  expect(onOpenCompany).not.toHaveBeenCalled();
  expect(state.openWithSplit).toHaveBeenCalledWith(
    { type: 'company', id: 'company-1' },
    { activate: true, preferNewSplit: true }
  );
});
