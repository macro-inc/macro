import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type JSX, type ParentProps, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSidePanelSections } from './EmailSidePanelSections';

const mocks = vi.hoisted(() => ({
  references: vi.fn(),
  labels: vi.fn(
    (): { id: string; linkId: string; name: string; fullName: string }[] => []
  ),
}));
vi.mock('@queries/email/thread-labels', () => ({
  useShownThreadLabels: () => () => mocks.labels(),
}));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => mocks.references(),
}));
vi.mock(
  '@app/features/email-thread/context/email-thread-state-context',
  () => ({
    useEmailThreadState: () => ({
      permissions: () => ({ isOwner: true, canReply: true }),
      thread: () => undefined,
    }),
  })
);
vi.mock('@app/features/activity/views/entity-activity-section', () => ({
  EntityActivitySectionConditional: () => null,
}));
vi.mock('@app/features/property/side-panel/properties', () => ({
  EntityPropertiesSection: () => null,
  EntityTagsSection: () => null,
}));
vi.mock('@core/component/References', () => ({
  References: () => <div>Reference details</div>,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Section: (props: ParentProps<{ title: JSX.Element }>) => (
      <section>
        {props.title}
        {props.children}
      </section>
    ),
    CountTitle: (props: { label: string; count: number }) => (
      <span>
        {props.label} ({props.count})
      </span>
    ),
    Loading: () => null,
    Footer: (props: ParentProps) => <footer>{props.children}</footer>,
  },
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  mocks.labels.mockReset();
  mocks.labels.mockReturnValue([]);
  for (const client of clients.splice(0)) client.clear();
});

describe('email optional references', () => {
  it('does not suspend the email body while references load, then updates the count', async () => {
    const response = Promise.withResolvers<unknown[]>();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    mocks.references.mockImplementation(() =>
      useQuery(() => ({
        queryKey: ['references-test'],
        queryFn: () => response.promise,
      }))
    );
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<div data-testid="loading" />}>
          <div data-testid="email">
            Cached body
            <textarea aria-label="Draft" value="Unsaved reply" />
            <EmailSidePanelSections threadId="thread" title="Subject" />
          </div>
        </Suspense>
      </QueryClientProvider>
    ));
    expect(screen.getByTestId('email').textContent).toContain('Cached body');
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByText('Reference details')).toBeNull();
    const editor = screen.getByRole('textbox');
    response.resolve([{}, {}]);
    await waitFor(() =>
      expect(screen.getByText('References (2)')).toBeTruthy()
    );
    expect(screen.getByText('Reference details')).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(screen.queryByTestId('loading')).toBeNull();
  });
});

describe('email labels', () => {
  const renderPanel = () => {
    mocks.references.mockReturnValue({ isSuccess: true, data: [] });
    render(() => <EmailSidePanelSections threadId="thread" title="Subject" />);
  };

  it('lists the thread labels by their whole names', () => {
    mocks.labels.mockReturnValue([
      {
        id: 'larkspur',
        linkId: 'inbox',
        name: 'Larkspur',
        fullName: 'Customers / Larkspur',
      },
      { id: 'orders', linkId: 'inbox', name: 'Orders', fullName: 'Orders' },
    ]);
    renderPanel();
    expect(screen.getByText('Labels')).toBeTruthy();
    expect(screen.getByText('Customers / Larkspur')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
    expect(screen.queryByText('Larkspur')).toBeNull();
  });

  it('leaves the section out when the thread has none', () => {
    renderPanel();
    expect(screen.queryByText('Labels')).toBeNull();
  });
});
