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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCrmContext } from '../context/crm-context';
import type { CrmCommentTarget } from '../context/workspace-context';
import type { CrmContact } from '../core/contact';
import type {
  CrmRecordRef,
  CrmRecordSection,
  CrmTaskRecord,
} from '../core/record';
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
vi.mock('../components/record-tabs', () => ({
  RecordTabs: (props: { onChange(section: CrmRecordSection): void }) => (
    <button type="button" onClick={() => props.onChange('emails')}>
      Show emails
    </button>
  ),
}));
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
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [{}] }));
vi.mock('./company-detail', async () => {
  const { useParamNavigationCount, useUrlParams } = await import(
    '@core/component/ParamsProvider'
  );
  return {
    // Reads its linked message the way the Discussion does.
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
      const params = useUrlParams({ commentId: 'comment_id' });
      const navigations = useParamNavigationCount('comment_id');
      return (
        <>
          <p data-testid="linked-message">
            {`${params.commentId() ?? '-'}:${navigations()}`}
          </p>
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
        </>
      );
    },
  };
});
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

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  taskContext.records.length = 0;
  taskContext.contactCompanyId = undefined;
  taskContext.recordError = () => false;
});

/** Stands in for the route: each open hands the detail a new trail. */
function renderDetail(record: CrmRecordRef, viewName: string) {
  const [records, setRecords] = createSignal<readonly CrmRecordRef[]>([record]);
  const [section, setSection] = createSignal<CrmRecordSection>();
  const [commentTarget, setCommentTarget] = createSignal<CrmCommentTarget>();
  const open = (trail: readonly CrmRecordRef[]) =>
    setRecords(trail.map((entry) => ({ ...entry })));
  const close = vi.fn(() => setRecords([]));
  const failed = vi.fn(() => <div>Navigation failed</div>);
  render(() => (
    <ErrorBoundary fallback={failed}>
      <Show
        when={records().length > 0}
        fallback={
          <button onClick={() => setRecords([record])}>
            Reopen {record.name}
          </button>
        }
      >
        <CrmRecordDetail
          records={records()}
          section={section()}
          commentTarget={commentTarget()}
          viewName={viewName}
          onOpen={open}
          onSectionChange={(next) => {
            setSection(next);
            open(records());
          }}
          onClose={close}
          navigation={null}
        />
      </Show>
    </ErrorBoundary>
  ));
  return { close, records, failed, setCommentTarget };
}

const crumbs = () =>
  within(screen.getByRole('navigation', { name: 'CRM record location' }))
    .getAllByRole('button')
    .map((button) => button.textContent);

it('removes contact breadcrumbs safely when returning to the company and reopening details', () => {
  const { failed } = renderDetail(
    { type: 'company', id: 'company-1', name: 'Northstar' },
    'Pipeline'
  );
  for (let round = 0; round < 2; round++) {
    fireEvent.click(screen.getByRole('button', { name: 'Open Maya' }));
    expect(crumbs()).toEqual(['Pipeline', 'Northstar', 'Maya']);
    expect(screen.getByText('Contact content: contact-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Northstar' }));
    expect(crumbs()).toEqual(['Pipeline', 'Northstar']);
    expect(screen.getByRole('button', { name: 'Open Maya' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline' }));
    expect(
      screen.queryByRole('navigation', { name: 'CRM record location' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Northstar' }));
  }
  expect(failed).not.toHaveBeenCalled();
});

it('opens a People contact in place and follows its company without duplicating the trail', () => {
  const { close, records } = renderDetail(
    { type: 'contact', id: 'contact-1', name: 'Maya' },
    'People'
  );
  expect(crumbs()).toEqual(['People', 'Maya']);
  expect(screen.getByText('Contact content: contact-1')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Open contact company' }));
  expect(crumbs()).toEqual(['People', 'Maya', 'Company']);
  expect(records().map((record) => record.id)).toEqual([
    'contact-1',
    'company-1',
  ]);

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
    taskContext.recordError = error;
    taskContext.contactCompanyId = 'company-1';
    renderDetail({ type, id: 'record-1', name: 'Selected record' }, 'Records');
    expect(taskContext.record?.()).toMatchObject({ type, id: 'record-1' });
    setError(true);
    expect(screen.getByText(`This ${type} couldn’t be loaded.`)).toBeTruthy();
    expect(taskContext.record?.()).toMatchObject({ type, id: 'record-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to view' }));
    expect(taskContext.record).toBeUndefined();
  }
);
it('keeps the shown record mounted while the route only changes its tab', () => {
  renderDetail({ type: 'contact', id: 'contact-1', name: 'Maya' }, 'People');
  const content = screen.getByText('Contact content: contact-1');
  fireEvent.click(screen.getByRole('button', { name: 'Show emails' }));
  expect(screen.getByText('Contact content: contact-1')).toBe(content);
  expect(crumbs()).toEqual(['People', 'Maya']);
});

it('hands the Discussion each request for a linked message', () => {
  const { setCommentTarget } = renderDetail(
    { type: 'company', id: 'company-1', name: 'Northstar' },
    'Companies'
  );
  const linked = () => screen.getByTestId('linked-message').textContent;
  expect(linked()).toBe('-:0');
  setCommentTarget({ commentId: 'message-1', seek: 'first' });
  expect(linked()).toBe('message-1:1');
  // The same message asked for again scrolls again.
  setCommentTarget({ commentId: 'message-1', seek: 'second' });
  expect(linked()).toBe('message-1:2');
  // Leaving the target, as another tab of the record does, forgets it.
  setCommentTarget(undefined);
  expect(linked()).toBe('-:2');
});
