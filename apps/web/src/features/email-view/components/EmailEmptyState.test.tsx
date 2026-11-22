/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailEmptyState } from './EmailEmptyState';

const fixture = vi.hoisted(() => ({
  selected: undefined as string[] | undefined,
  links: [] as {
    id: string;
    is_sync_active: boolean;
    needs_reauth: boolean;
    sync_status: string;
    mailbox_issue?: string;
    mailbox_retry_at?: string;
  }[],
}));
vi.mock('@queries/email/focus', () => ({ FOCUS_WINDOW_DAYS: 30 }));
vi.mock('@core/email-link', () => ({
  useEmailLinksStatus: () => () => true,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isPending: false,
    get data() {
      return { links: fixture.links };
    },
  }),
  useInboxSuggestion: () => ({ isPending: true }),
}));
vi.mock('../email-view-context', () => ({
  useEmailView: () => ({
    state: {
      get inboxIds() {
        return fixture.selected;
      },
      tab: 'important',
      search: '',
    },
    filtersChanged: () => false,
  }),
}));
vi.mock('@ui', () => ({
  EmptyStatePanel: (props: {
    title: string;
    description: string;
    children?: JSX.Element;
  }) => (
    <section>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.children}
    </section>
  ),
  Spinner: () => <span />,
  FilteredHiddenBanner: () => <span />,
}));
afterEach(() => {
  cleanup();
  fixture.selected = undefined;
  fixture.links = [];
});

it('shows first-sync progress instead of Inbox zero and settles without remounting', async () => {
  const [status, setStatus] = createSignal('SYNCING');
  fixture.links = [
    {
      id: 'new-inbox',
      is_sync_active: true,
      needs_reauth: false,
      get sync_status() {
        return status();
      },
    },
  ];
  render(() => <EmailEmptyState onConnect={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain(
    'Syncing your inbox'
  );
  expect(screen.queryByText('Inbox zero')).toBeNull();
  setStatus('SYNCED');
  expect(await screen.findByText('Inbox zero')).toBeDefined();
});

it.each([
  { status: 'SYNCING', issue: undefined },
  { status: 'ERROR', issue: 'snapshot_too_large' },
])(
  'keeps an unselected $status inbox from hiding the selected empty inbox',
  ({ status, issue }) => {
    fixture.selected = ['selected'];
    fixture.links = [
      {
        id: 'other',
        is_sync_active: true,
        needs_reauth: false,
        sync_status: status,
        mailbox_issue: issue,
      },
    ];
    render(() => <EmailEmptyState onConnect={vi.fn()} />);
    expect(screen.getByText('Inbox zero')).toBeDefined();
  }
);

it('does not claim an oversized selected inbox is caught up and recovers without remounting', async () => {
  const [issue, setIssue] = createSignal<string | undefined>(
    'snapshot_too_large'
  );
  fixture.links = [
    {
      id: 'oversized',
      is_sync_active: true,
      needs_reauth: false,
      sync_status: 'ERROR',
      mailbox_retry_at: '2030-01-01T12:00:00Z',
      get mailbox_issue() {
        return issue();
      },
    },
  ];
  render(() => <EmailEmptyState onConnect={vi.fn()} />);
  expect(screen.queryByText('Inbox zero')).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'Mailbox too large to sync yet' })
  ).toBeDefined();
  expect(screen.getByText(/Macro will retry at/)).toBeDefined();
  setIssue(undefined);
  expect(await screen.findByText('Inbox zero')).toBeDefined();
});

it('keeps an unreadable saved password visible as reconnect health, not Inbox zero', () => {
  fixture.links = [
    {
      id: 'selected',
      is_sync_active: true,
      needs_reauth: true,
      sync_status: 'ERROR',
      mailbox_issue: 'credentials_unreadable',
    },
  ];
  render(() => <EmailEmptyState onConnect={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain(
    "Macro can't read this mailbox's saved password"
  );
  expect(screen.queryByText('Inbox zero')).toBeNull();
});
