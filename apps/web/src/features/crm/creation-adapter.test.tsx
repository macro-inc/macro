import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  allowed: (): boolean => true,
  navigate: vi.fn(),
  created: undefined as ((id: string) => void) | undefined,
}));

vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => fixture.allowed(),
}));
vi.mock('@core/util/createControlledOpenSignal', () => ({
  useFocusLock: () => ({ acquire: vi.fn(), release: vi.fn() }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceOrInsertSplit: fixture.navigate }),
}));
vi.mock('./context/crm-context', () => ({
  CrmProvider: (props: ParentProps) => props.children,
}));
vi.mock('./crm-adapter', () => ({ createAppCrmContext: () => ({}) }));
vi.mock('./views/create-company', () => ({
  CreateCompanyModal: (props: { onCreated(id: string): void }) => {
    fixture.created = props.onCreated;
    return null;
  },
}));
vi.mock('./views/create-contact', () => ({
  CreateContactModal: (props: { onCreated(id: string): void }) => {
    fixture.created = props.onCreated;
    return null;
  },
}));

import {
  companyCreation,
  contactCreation,
  openCreateCompanyModal,
  openCreateContactModal,
} from './creation-adapter';
import { CreateCompanyModal, CreateContactModal } from './crm-create';

beforeEach(() => {
  fixture.allowed = () => true;
  fixture.navigate.mockReset();
  fixture.created = undefined;
  companyCreation.close();
  contactCreation.close();
});
afterEach(cleanup);

it.each(['company', 'contact'] as const)(
  'does not launch a %s create dialog after a proven denial',
  (kind) => {
    fixture.allowed = () => false;
    if (kind === 'company') openCreateCompanyModal();
    else openCreateContactModal({ companyId: 'company' });
    expect(companyCreation.open()).toBe(false);
    expect(contactCreation.target()).toBeUndefined();
  }
);

it.each(['company', 'contact'] as const)(
  'closes an open %s dialog on denial without reopening it on regrant',
  (kind) => {
    const [allowed, setAllowed] = createSignal(true);
    fixture.allowed = allowed;
    if (kind === 'company') {
      render(() => <CreateCompanyModal />);
      openCreateCompanyModal();
      expect(companyCreation.open()).toBe(true);
    } else {
      render(() => <CreateContactModal />);
      openCreateContactModal({ companyId: 'company' });
      expect(contactCreation.target()).toEqual({
        company: { companyId: 'company' },
      });
    }
    setAllowed(false);
    expect(companyCreation.open()).toBe(false);
    expect(contactCreation.target()).toBeUndefined();
    setAllowed(true);
    expect(companyCreation.open()).toBe(false);
    expect(contactCreation.target()).toBeUndefined();
  }
);

it.each(['company', 'contact'] as const)(
  'does not navigate from a committed %s create after access closes',
  (kind) => {
    const [allowed, setAllowed] = createSignal(true);
    fixture.allowed = allowed;
    if (kind === 'company') render(() => <CreateCompanyModal />);
    else render(() => <CreateContactModal />);
    setAllowed(false);
    fixture.created?.('created-record');
    expect(fixture.navigate).not.toHaveBeenCalled();
  }
);
