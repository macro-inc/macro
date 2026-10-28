import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { createEditor } from 'lexical';
import { type ParentProps, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../shared/inlineMenu';
import { TagsMenu } from './TagsMenu';

const mocks = vi.hoisted(() => ({ team: vi.fn() }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => mocks.team(),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ data: [] }),
  useEnsureTagSetMutation: () => ({ isPending: false }),
  invalidateTags: vi.fn(),
}));
vi.mock('@queries/properties/options', () => ({
  useAddPropertyOptionMutation: () => ({ isPending: false }),
}));
vi.mock('./useMenuKeyboardNavigation', () => ({
  useMenuKeyboardNavigation: vi.fn(),
}));
vi.mock('./InlineFollowupMenu', () => ({ InlineFollowupMenu: () => null }));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
}));
vi.mock('../../plugins', () => ({
  CLOSE_INLINE_SEARCH_COMMAND: {},
  REMOVE_INLINE_SEARCH_COMMAND: {},
}));
vi.mock('../../plugins/tags', () => ({ INSERT_TAG_MENTION_COMMAND: {} }));
vi.mock('@property/tags/TagDot', () => ({ TagDot: () => null }));
vi.mock('@ui', () => ({
  Surface: (props: ParentProps) => <div>{props.children}</div>,
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe('closed inline tags menu', () => {
  it.each([true, false])(
    'does not suspend its editor on missing team metadata (enabled=%s)',
    (enabled) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      clients.push(client);
      mocks.team.mockImplementation(() =>
        useQuery(() => ({
          queryKey: ['team-test'],
          enabled,
          queryFn: () => new Promise(() => {}),
        }))
      );
      function Editor() {
        const menu = createMenuOperations();
        return (
          <div data-testid="editor">
            Cached body
            <TagsMenu editor={createEditor()} menu={menu} />
          </div>
        );
      }
      render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<div data-testid="loading" />}>
            <Editor />
          </Suspense>
        </QueryClientProvider>
      ));
      expect(screen.getByTestId('editor').textContent).toBe('Cached body');
      expect(screen.queryByTestId('loading')).toBeNull();
    }
  );
});
