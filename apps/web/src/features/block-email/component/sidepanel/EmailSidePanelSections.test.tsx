import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type JSX, type ParentProps, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSidePanelSections } from './EmailSidePanelSections';

const mocks = vi.hoisted(() => ({ references: vi.fn() }));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => mocks.references(),
}));
vi.mock(
  '@app/features/email-thread/context/email-thread-state-context',
  () => ({
    useEmailThreadState: () => ({ permissions: () => ({ isOwner: true }) }),
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
  },
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
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
            <EmailSidePanelSections threadId="thread" title="Subject" />
          </div>
        </Suspense>
      </QueryClientProvider>
    ));
    expect(screen.getByTestId('email').textContent).toContain('Cached body');
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByText('Reference details')).toBeNull();
    response.resolve([{}, {}]);
    await waitFor(() =>
      expect(screen.getByText('References (2)')).toBeTruthy()
    );
    expect(screen.getByText('Reference details')).toBeTruthy();
    expect(screen.queryByTestId('loading')).toBeNull();
  });
});
