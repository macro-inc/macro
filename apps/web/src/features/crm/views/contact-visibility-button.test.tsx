import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmContact } from '../core/contact';

const state = vi.hoisted(() => ({
  contact: undefined as unknown as CrmContact,
  companyReads: [] as string[],
  company: undefined as { hidden: boolean } | undefined,
  companyError: false,
}));

vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    createNavigation: () => ({ openWithSplit: vi.fn() }),
    feedback: { success: vi.fn(), failure: vi.fn() },
  }),
}));
vi.mock('./use-crm', () => ({
  useContactQuery: () => ({ isSuccess: true, data: state.contact }),
  useCompanyQuery: (id: () => string) => ({
    company: () => {
      const companyId = id();
      if (companyId) state.companyReads.push(companyId);
      return companyId ? state.company : undefined;
    },
    query: {
      get isLoading() {
        return !!id() && !state.company && !state.companyError;
      },
      get isError() {
        return !!id() && state.companyError;
      },
      refetch: vi.fn(),
    },
  }),
  useIsTeamAdmin: () => () => true,
  useSetContactHiddenMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../components/record-visibility-action', () => ({
  RecordVisibilityAction: (props: {
    parentArchived?: boolean;
    parentPending?: boolean;
  }) => (
    <span>
      {props.parentPending
        ? 'checking company'
        : props.parentArchived
          ? 'restore the company first'
          : 'restore'}
    </span>
  ),
}));

import { ContactVisibilityButton } from './contact-visibility-button';

afterEach(() => {
  cleanup();
  state.companyReads = [];
  state.company = undefined;
  state.companyError = false;
});

function archivedContact(company?: CrmContact['company']): CrmContact {
  return {
    id: 'contact-1',
    companyId: 'company-1',
    company,
    hidden: true,
    firstInteraction: '',
    lastInteraction: '',
    createdAt: '',
    updatedAt: '',
  };
}

it("reads the company's archive from the contact detail without reading the company", () => {
  state.contact = archivedContact({
    id: 'company-1',
    name: 'Acme',
    hidden: true,
  });
  render(() => <ContactVisibilityButton contactId="contact-1" identity />);

  expect(screen.getByText('restore the company first')).toBeTruthy();
  expect(screen.queryByText('Retry company check')).toBeNull();
  expect(state.companyReads).toEqual([]);
});

it('reads the company when the contact detail has no summary', () => {
  state.contact = archivedContact();
  state.company = { hidden: true };
  render(() => <ContactVisibilityButton contactId="contact-1" identity />);

  expect(screen.getByText('restore the company first')).toBeTruthy();
  expect(state.companyReads).toContain('company-1');
});

it('offers a retry when the company read fails without a summary', () => {
  state.contact = archivedContact();
  state.companyError = true;
  render(() => <ContactVisibilityButton contactId="contact-1" identity />);

  expect(screen.getByText('checking company')).toBeTruthy();
  expect(screen.getByText('Retry company check')).toBeTruthy();
});
