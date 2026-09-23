import type { TaskDuplicate } from '@service-storage/client';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type ParentProps, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDuplicateMatchPill } from './TaskDuplicateMatches';

const mocks = vi.hoisted(() => ({ matches: vi.fn(), enabled: true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled }),
}));
vi.mock('@queries/storage/task-duplicates', () => ({
  useTaskDuplicatesQuery: () => mocks.matches(),
  useDismissTaskDuplicatesMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({ documentId: () => 'doc' }),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Section: (props: ParentProps) => props.children },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/DocumentMention',
  () => ({ DocumentMention: () => null })
);
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@ui', () => {
  const Container = (props: ParentProps) => <div>{props.children}</div>;
  return {
    cn: () => '',
    Button: Container,
    Dropdown: Object.assign(Container, {
      Trigger: Container,
      Content: Container,
      Group: Container,
    }),
  };
});

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  mocks.enabled = true;
});

function mount() {
  const response = Promise.withResolvers<TaskDuplicate[]>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  mocks.matches.mockImplementation(() =>
    useQuery(() => ({
      queryKey: ['duplicates-test'],
      queryFn: () => response.promise,
    }))
  );
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>
        <div data-testid="editor">
          Cached body
          <TaskDuplicateMatchPill />
        </div>
      </Suspense>
    </QueryClientProvider>
  ));
  return response;
}

describe('optional task duplicate matches', () => {
  it('does not suspend the editor while matches are pending and renders matches when ready', async () => {
    const response = mount();
    expect(screen.getByTestId('editor').textContent).toBe('Cached body');
    expect(screen.queryByTestId('loading')).toBeNull();
    response.resolve([
      { id: 'match', taskId: 'task', taskName: 'Similar task', vectorScore: 1 },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('editor').textContent).toContain(
        'Possible duplicate'
      )
    );
  });

  it('does not suspend when the duplicate feature is disabled', () => {
    mocks.enabled = false;
    mount();
    expect(screen.getByTestId('editor').textContent).toBe('Cached body');
    expect(screen.queryByTestId('loading')).toBeNull();
  });
});
