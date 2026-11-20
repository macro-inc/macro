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
  }[],
}));
vi.mock('@queries/email/focus', () => ({ FOCUS_WINDOW_DAYS: 30 }));
vi.mock('@core/email-link', () => ({
  useEmailLinksStatus: () => () => true,
  useAddInboxFlow: () => vi.fn(),
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
  render(() => <EmailEmptyState />);
  expect(screen.getByRole('status').textContent).toContain(
    'Syncing your inbox'
  );
  expect(screen.queryByText('Inbox zero')).toBeNull();
  setStatus('SYNCED');
  expect(await screen.findByText('Inbox zero')).toBeDefined();
});

it('does not let an unselected syncing inbox hide the selected empty inbox', () => {
  fixture.selected = ['selected'];
  fixture.links = [
    {
      id: 'other',
      is_sync_active: true,
      needs_reauth: false,
      sync_status: 'SYNCING',
    },
  ];
  render(() => <EmailEmptyState />);
  expect(screen.getByText('Inbox zero')).toBeDefined();
});
