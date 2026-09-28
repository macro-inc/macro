import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSidePanelSections } from './EmailSidePanelSections';

const fetchReferences = vi.hoisted(() => vi.fn());

vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () =>
    useQuery(() => ({
      queryKey: ['references'],
      queryFn: fetchReferences,
    })),
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
  References: () => <div>Loaded references</div>,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Section: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    CountTitle: () => null,
    Loading: () => <div>Loading section</div>,
  },
}));

afterEach(cleanup);

it('keeps the composer visible while sidebar references load', async () => {
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  fetchReferences.mockReturnValue(promise);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div>Hidden email</div>}>
        <input aria-label="Draft body" />
        <EmailSidePanelSections threadId="draft-thread" title="Draft" />
      </Suspense>
    </QueryClientProvider>
  ));
  const editor = screen.getByRole('textbox');
  expect(screen.queryByText('Hidden email')).toBeNull();
  resolve([{}]);
  await screen.findByText('Loaded references');
  expect(screen.getByRole('textbox')).toBe(editor);
});
