import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';

const state = vi.hoisted(() => ({ companyReads: [] as string[] }));

vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    createNavigation: () => ({ openWithSplit: vi.fn() }),
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
  ContactCompanyProperty: (props: { companyName?: string }) => (
    <span>{props.companyName ?? 'no company name'}</span>
  ),
}));

import { ContactCompanyField } from './contact-properties';

afterEach(() => {
  cleanup();
  state.companyReads = [];
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
