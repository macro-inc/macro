import type { EntityItem } from '@core/context/quickAccess';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createEditor } from 'lexical';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSERT_AGENT_COMMAND_COMMAND,
  REMOVE_AGENT_COMMAND_SEARCH_COMMAND,
} from '../../../plugins/agent-commands';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_PR_MENTION_COMMAND,
} from '../../../plugins/mentions';
import { createMenuOperations } from '../../../shared/inlineMenu';
import { SkillsMenu } from './SkillsMenu';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
}));
const skill = (id: string, name: string, ownerId: string): EntityItem => ({
  kind: 'entity',
  id,
  bucket: 'skill',
  searchText: name.toLowerCase(),
  sortTimestamp: 0,
  timestamps: {},
  data: {
    id,
    name,
    ownerId,
    type: 'document',
    fileType: 'md',
    subType: { type: 'skill' },
  },
});

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: mocks.open,
    popoverSplit: mocks.create,
  }),
}));
vi.mock('@app/features/next-soup/actions/make-delete-action', () => ({
  makeDeleteAction: () => ({
    canExecute: (item: { ownerId: string }) => item.ownerId === 'me',
    execute: mocks.delete,
  }),
}));
vi.mock('@queries/storage/system-skills', () => ({
  useSystemSkillsQuery: () => ({
    skills: () => [{ id: 'builtin', name: 'Built-in guide' }],
    isSystemSkillId: (id: string) => id === 'builtin',
  }),
}));
vi.mock('@queries/soup/slash-menu-pull-requests', () => ({
  useSlashMenuPullRequests: () => ({
    query: { isPending: false, isError: false },
    pullRequests: () => [
      {
        id: 'pr-42',
        name: 'Fix skills',
        metadata: { owner: 'macro', repo: 'app', number: 42 },
      },
    ],
  }),
}));
vi.mock('../MentionsMenu/hooks/useEntityMention', () => ({
  useEntityMention: (options: { searchTerm: () => string }) => ({
    entities: () =>
      [
        skill('mine', 'My skill', 'me'),
        skill('shared', 'Shared skill', 'someone'),
      ].filter((item) =>
        item.searchText.includes(options.searchTerm().toLowerCase())
      ),
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
vi.mock('../../../plugins/mentions', () => ({
  INSERT_DOCUMENT_MENTION_COMMAND: { type: 'insert-document' },
  INSERT_PR_MENTION_COMMAND: { type: 'insert-pr' },
}));
vi.mock('@ui', () => ({
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  cn: (base: string) => base,
}));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function setup(agent = true) {
  const editor = createEditor();
  const dispatch = vi.spyOn(editor, 'dispatchCommand');
  const menu = createMenuOperations();
  const [commands, setCommands] = createSignal([
    { name: 'compact', description: 'Summarize context', inputHint: null },
  ]);
  render(() => (
    <SkillsMenu
      editor={editor}
      menu={menu}
      agentCommands={agent ? commands : undefined}
    />
  ));
  menu.openMenu();
  return { editor, dispatch, menu, setCommands };
}

describe('skill slash menu', () => {
  it('offers skills and PRs before the harness advertises commands', () => {
    const { setCommands } = setup();
    setCommands([]);
    expect(screen.getByText('My skill')).toBeTruthy();
    expect(screen.getByText('Pull requests')).toBeTruthy();
    expect(screen.getByText('Fix skills')).toBeTruthy();
    expect(screen.getByText('No commands available')).toBeTruthy();
  });

  it('inserts a skill through the agent search plugin', () => {
    const { dispatch, menu } = setup();
    fireEvent.click(screen.getByText('My skill'));
    expect(dispatch).toHaveBeenCalledWith(
      REMOVE_AGENT_COMMAND_SEARCH_COMMAND,
      undefined
    );
    expect(dispatch).toHaveBeenCalledWith(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: 'mine',
      documentName: 'My skill',
      blockName: 'skill',
    });
    expect(menu.isOpen()).toBe(false);
  });

  it('opens the existing skill without inserting a mention', () => {
    const { dispatch, menu } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit My skill' }));
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'skill', id: 'mine' },
      { preferNewSplit: true }
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      INSERT_DOCUMENT_MENTION_COMMAND,
      expect.anything()
    );
    expect(menu.isOpen()).toBe(false);
  });

  it('offers deletion only for owned documents and reuses the delete flow', () => {
    setup();
    expect(
      screen.queryByRole('button', { name: 'Delete Shared skill' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit Built-in/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Delete Built-in/ })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete My skill' }));
    expect(mocks.delete).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'mine' }),
    ]);
  });

  it('navigates across sections and inserts a PR chip then a command', () => {
    const { dispatch, menu } = setup();
    for (let i = 0; i < 3; i++)
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith(INSERT_PR_MENTION_COMMAND, {
      id: 'pr-42',
      label: 'macro/app#42',
    });
    menu.openMenu();
    for (let i = 0; i < 4; i++)
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith(INSERT_AGENT_COMMAND_COMMAND, {
      name: 'compact',
      description: 'Summarize context',
      inputHint: null,
    });
  });

  it('filters all sections and keeps new-skill creation selectable', async () => {
    const { menu } = setup();
    menu.setSearchTerm('compact');
    await waitFor(() => expect(screen.queryByText('My skill')).toBeNull());
    expect(screen.queryByText('Fix skills')).toBeNull();
    expect(screen.getByText('/compact')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'skill-compose' })
    );
  });

  it('keeps regular chat menus limited to skills with the same edit controls', () => {
    setup(false);
    expect(screen.queryByText('Pull requests')).toBeNull();
    expect(screen.queryByText('Commands')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit My skill' })).toBeTruthy();
  });
});
