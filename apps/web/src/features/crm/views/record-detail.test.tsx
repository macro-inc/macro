import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  createSignal,
  ErrorBoundary,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact } from '../core/contact';
import type { CrmTaskRecord } from '../core/record';
import { CrmRecordDetail } from './record-detail';

const taskContext = vi.hoisted(() => ({
  records: [] as (() => CrmTaskRecord)[],
  get record() {
    return this.records.at(-1);
  },
  contactCompanyId: undefined as string | undefined,
  recordError: (): boolean => false,
}));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    listsEnabled: () => () => false,
    pipelinesEnabled: () => () => false,
    isTeamAdmin: () => () => false,
    openCreateContact: vi.fn(),
    registerTaskComposerRecord: (source: () => CrmTaskRecord) => {
      taskContext.records.push(source);
      return () => {
        const index = taskContext.records.indexOf(source);
        if (index !== -1) taskContext.records.splice(index, 1);
      };
    },
  }),
}));

vi.mock('@ui', async () => ({
  ...(await import('../../../components/ui/utils/classname')),
  Tooltip: (props: ParentProps) => <>{props.children}</>,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: ParentProps) => <>{props.children}</>,
    Layout: (props: ParentProps) => <>{props.children}</>,
    Section: (props: ParentProps) => <>{props.children}</>,
    Toggle: () => null,
  },
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('./copy-link-button', () => ({ CrmCopyLinkButton: () => null }));
vi.mock('../components/record-tabs', () => ({ RecordTabs: () => null }));
vi.mock('./use-crm', () => ({
  useCompanyQuery: () => ({
    query: {
      get isError() {
        return taskContext.recordError();
      },
    },
    company: () => undefined,
    contacts: () => [],
  }),
  useContactQuery: () => ({
    isSuccess: !!taskContext.contactCompanyId,
    get isError() {
      return taskContext.recordError();
    },
    data: taskContext.contactCompanyId
      ? { companyId: taskContext.contactCompanyId }
      : undefined,
  }),
  useIsTeamAdmin: () => () => false,
}));
vi.mock('./company-detail', () => ({
  Company: (props: {
    companyId: string;
    onOpenContact(contact: CrmContact): void;
  }) => {
    onCleanup(
      useCrmContext().registerTaskComposerRecord(() => ({
        type: 'company',
        id: props.companyId,
      }))
    );
    return (
      <button
        onClick={() =>
          props.onOpenContact({
            id: 'contact-1',
            companyId: 'company-1',
            name: 'Maya',
            email: 'maya@company.com',
            hidden: false,
            firstInteraction: '',
            lastInteraction: '',
            createdAt: '',
            updatedAt: '',
          })
        }
      >
        Open Maya
      </button>
    );
  },
}));
vi.mock('./contact-detail', () => ({
  Contact: (props: {
    contactId: string;
    onOpenCompany(companyId: string): boolean;
  }) => {
    onCleanup(
      useCrmContext().registerTaskComposerRecord(() => ({
        type: 'contact',
        id: props.contactId,
        companyId: taskContext.contactCompanyId,
      }))
    );
    return (
      <div>
        Contact content: {props.contactId}
        <button onClick={() => props.onOpenCompany('company-1')}>
          Open contact company
        </button>
      </div>
    );
  },
}));
// The breadcrumb test replaces detail views, while registration tests load their real roots.
vi.mock('./company-contacts-section', () => ({
  CompanyContactsSection: () => null,
}));
vi.mock('./company-discussion-section', () => ({
  CompanyDiscussionSection: () => null,
}));
vi.mock('./company-emails-section', () => ({
  CompanyEmailsSection: () => null,
}));
vi.mock('./company-header', () => ({ CompanyHeader: () => null }));
vi.mock('./company-list-membership', () => ({
  CompanyListsSection: () => null,
}));
vi.mock('./company-properties-section', () => ({
  CompanyPropertiesSection: () => null,
}));
vi.mock('./company-sharing-section', () => ({
  CompanySharingSection: () => null,
}));
vi.mock('./contact-discussion-section', () => ({
  ContactDiscussionSection: () => null,
}));
vi.mock('./contact-emails-section', () => ({
  ContactEmailsSection: () => null,
}));
vi.mock('./contact-header', () => ({ ContactHeader: () => null }));
vi.mock('./contact-sharing-section', () => ({
  ContactSharingSection: () => null,
}));
vi.mock('./record-associations', () => ({
  RecordCallsSection: () => null,
  RecordFilesSection: () => null,
  RecordReferencesSection: () => null,
}));

afterEach(() => {
  cleanup();
  taskContext.records.length = 0;
  taskContext.contactCompanyId = undefined;
  taskContext.recordError = () => false;
});

it('removes contact breadcrumbs safely when returning to the company and reopening details', () => {
  const failed = vi.fn(() => <div>Navigation failed</div>);
  const [selected, setSelected] = createSignal(true);
  render(() => (
    <ErrorBoundary fallback={failed}>
      <Show
        when={selected()}
        fallback={
          <button onClick={() => setSelected(true)}>Open company</button>
        }
      >
        <CrmRecordDetail
          record={{ type: 'company', id: 'company-1', name: 'Northstar' }}
          viewName="Pipeline"
          onClose={() => setSelected(false)}
          navigation={null}
        />
      </Show>
    </ErrorBoundary>
  ));
  for (let round = 0; round < 2; round++) {
    fireEvent.click(screen.getByRole('button', { name: 'Open Maya' }));
    const breadcrumbs = () =>
      within(screen.getByRole('navigation', { name: 'CRM record location' }));
    expect(breadcrumbs().getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Contact content: contact-1')).toBeTruthy();
    fireEvent.click(breadcrumbs().getByRole('button', { name: 'Northstar' }));
    expect(failed).not.toHaveBeenCalled();
    expect(breadcrumbs().getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open Maya' })).toBeTruthy();
    fireEvent.click(breadcrumbs().getByRole('button', { name: 'Pipeline' }));
    expect(
      screen.queryByRole('navigation', { name: 'CRM record location' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open company' }));
  }
  expect(failed).not.toHaveBeenCalled();
});

it('opens a People contact in place and follows its company without duplicating the trail', () => {
  const close = vi.fn();
  render(() => (
    <CrmRecordDetail
      record={{ type: 'contact', id: 'contact-1', name: 'Maya' }}
      viewName="People"
      onClose={close}
      navigation={null}
    />
  ));
  const crumbs = () =>
    within(screen.getByRole('navigation', { name: 'CRM record location' }))
      .getAllByRole('button')
      .map((button) => button.textContent);
  expect(crumbs()).toEqual(['People', 'Maya']);
  expect(screen.getByText('Contact content: contact-1')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Open contact company' }));
  expect(crumbs()).toEqual(['People', 'Maya', 'Company']);

  // The company's contact is already in the trail, so opening it returns there.
  fireEvent.click(screen.getByRole('button', { name: 'Open Maya' }));
  expect(crumbs()).toEqual(['People', 'Maya']);

  fireEvent.click(screen.getByRole('button', { name: 'People' }));
  expect(close).toHaveBeenCalledOnce();
});

it('registers the actual company detail while mounted and clears it on unmount', async () => {
  const { Company } =
    await vi.importActual<typeof import('./company-detail')>(
      './company-detail'
    );
  const result = render(() => (
    <Company companyId="company-1" section="files" />
  ));
  expect(taskContext.record?.()).toEqual({ type: 'company', id: 'company-1' });
  result.unmount();
  expect(taskContext.record).toBeUndefined();
});

it('registers the actual contact detail with its loaded company', async () => {
  const { Contact } =
    await vi.importActual<typeof import('./contact-detail')>(
      './contact-detail'
    );
  taskContext.contactCompanyId = 'company-1';
  const result = render(() => (
    <Contact contactId="contact-1" section="files" />
  ));
  expect(taskContext.record?.()).toEqual({
    type: 'contact',
    id: 'contact-1',
    companyId: 'company-1',
  });
  result.unmount();
  expect(taskContext.record).toBeUndefined();
});

it('registers an unloaded contact without an unrelated company', async () => {
  const { Contact } =
    await vi.importActual<typeof import('./contact-detail')>(
      './contact-detail'
    );
  const result = render(() => (
    <Contact contactId="contact-2" section="files" />
  ));
  expect(taskContext.record?.()).toEqual({
    type: 'contact',
    id: 'contact-2',
    companyId: undefined,
  });
  result.unmount();
  expect(taskContext.record).toBeUndefined();
});

it.each(['company', 'contact'] as const)(
  'keeps the selected %s association when the detail query fails',
  (type) => {
    const [error, setError] = createSignal(false);
    const [open, setOpen] = createSignal(true);
    taskContext.recordError = error;
    taskContext.contactCompanyId = 'company-1';
    render(() => (
      <Show when={open()}>
        <CrmRecordDetail
          record={{ type, id: 'record-1', name: 'Selected record' }}
          viewName="Records"
          onClose={() => setOpen(false)}
          navigation={null}
        />
      </Show>
    ));
    expect(taskContext.record?.()).toMatchObject({ type, id: 'record-1' });
    setError(true);
    expect(screen.getByText(`This ${type} couldn’t be loaded.`)).toBeTruthy();
    expect(taskContext.record?.()).toMatchObject({ type, id: 'record-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to view' }));
    expect(taskContext.record).toBeUndefined();
  }
);
