import type { EntityItem } from '@core/context/quickAccess';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createEditor } from 'lexical';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../../shared/inlineMenu';
import { SnippetsMenu } from './SnippetsMenu';

const mocks = vi.hoisted(() => ({
  snippetReads: vi.fn(),
  snippetName: 'Greeting',
}));

const snippet = (name: string): EntityItem => ({
  kind: 'entity',
  id: 'snippet-1',
  bucket: 'snippet',
  searchText: name.toLowerCase(),
  sortTimestamp: 0,
  timestamps: {},
  data: {
    id: 'snippet-1',
    name,
    ownerId: 'me',
    type: 'document',
    fileType: 'md',
    subType: { type: 'snippet' },
  },
});

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@queries/storage/snippets', () => ({ fetchSnippetRaw: vi.fn() }));
vi.mock('../../../plugins/snippets', () => ({
  CLOSE_SNIPPET_SEARCH_COMMAND: { type: 'close-snippet-search' },
  INSERT_SNIPPET_COMMAND: { type: 'insert-snippet' },
}));
vi.mock('../MentionsMenu/hooks/useEntityMention', () => ({
  useEntityMention: () => ({
    entities: () => {
      mocks.snippetReads();
      return [snippet(mocks.snippetName)];
    },
  }),
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('../../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('@ui', () => ({
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  cn: (base: string) => base,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snippetName = 'Greeting';
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it('reads no snippets while closed and current ones when reopened', () => {
  const menu = createMenuOperations();
  render(() => <SnippetsMenu editor={createEditor()} menu={menu} />);
  expect(mocks.snippetReads).not.toHaveBeenCalled();

  menu.openMenu();
  expect(screen.getByText('Greeting')).toBeTruthy();
  menu.closeMenu();
  expect(screen.queryByText('Greeting')).toBeNull();

  mocks.snippetName = 'Sign-off';
  menu.openMenu();
  expect(screen.getByText('Sign-off')).toBeTruthy();
});
