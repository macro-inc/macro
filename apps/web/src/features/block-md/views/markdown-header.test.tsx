import type { BlockTool } from '@components/app/block-tool';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownHeader } from './markdown-header';

const item = vi.hoisted(() => ({ kind: 'task', share: vi.fn() }));
const document = vi.hoisted(() => ({ entity: false, canEdit: true }));

vi.mock('@app/features/entity-appearance/entity-appearance', () => ({
  EntityAppearanceTrigger: (props: { editable: boolean }) => (
    <span
      role="img"
      aria-label={props.editable ? 'Change icon' : 'Document icon'}
    />
  ),
}));
vi.mock('@app/features/entity-appearance/queries/document-appearance', () => ({
  useDocumentAppearance: () => () => undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_MARKDOWN_SIDE_PANEL: true,
}));
vi.mock('@components/app/CollaborationStatusIndicator', () => ({
  CollaborationStatusIndicator: () => null,
  isCollaborationStatusVisible: () => false,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => <>{props.children}</>,
  SplitHeaderRight: (props: { children: JSX.Element }) => <>{props.children}</>,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  BlockItemSplitLabel: (props: {
    name: Accessor<string | undefined>;
    icon: JSX.Element;
  }) => (
    <>
      {props.icon}
      <h1>{props.name()}</h1>
    </>
  ),
  SplitPermissionsBadge: () => null,
}));
vi.mock('@components/app/block-toolbar', () => ({
  BlockToolbar: (props: { trailing: JSX.Element; menuTools: BlockTool[] }) => (
    <>
      {props.trailing}
      <menu aria-label="Title menu">
        <For each={props.menuTools}>
          {(tool) => (
            <li>
              <button>{tool.label as string}</button>
            </li>
          )}
        </For>
      </menu>
    </>
  ),
}));
vi.mock('@components/app/HeaderActionGroup', () => ({
  HeaderActionGroup: (props: { children: JSX.Element }) => (
    <>{props.children}</>
  ),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    HeaderActions: (props: { children: JSX.Element }) => <>{props.children}</>,
  },
}));
vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => null,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: (props: { onClick: () => void }) => (
    <button onClick={props.onClick}>Share</button>
  ),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => <button>Ask Macro</button>,
}));
vi.mock('../component/DispatchAgentMenu', () => ({
  DispatchAgentButton: () => <button>Dispatch Agent</button>,
}));
vi.mock('../component/MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Ship the release' }),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'doc-1',
    kind: () => item.kind,
    entity: () =>
      document.entity && {
        type: 'document',
        id: 'doc-1',
        name: 'Ship the release',
        fileType: 'md',
      },
    permissions: { canEdit: () => document.canEdit },
  }),
}));
vi.mock('../component/useMarkdownDocumentTools', () => ({
  useMarkdownDocumentTools: () => {
    const action = (label: string) => ({
      label,
      icon: () => null,
      action: () => {},
    });
    return {
      fileOperations: [],
      openShare: item.share,
      actions: {
        history: action('History'),
        wideMode: action('Turn on wide mode'),
        askMacro: action('Ask Macro'),
        codeActions: action('Code Actions'),
        share: action('Share'),
      },
    };
  },
}));

afterEach(() => {
  cleanup();
  item.kind = 'task';
  item.share.mockClear();
  document.entity = false;
  document.canEdit = true;
});

const headerButtons = () =>
  screen
    .getAllByRole('button')
    .filter((button) => !button.closest('menu'))
    .map((button) => button.textContent);

const menuRows = () =>
  screen
    .getAllByRole('button')
    .filter((button) => button.closest('menu'))
    .map((button) => button.textContent);

it('offers Dispatch Agent, Ask Macro and Share on a task', () => {
  render(() => <MarkdownHeader collaborationStatus={() => undefined} />);

  expect(
    screen.getByRole('heading', { name: 'Ship the release' })
  ).toBeTruthy();
  expect(headerButtons()).toEqual(['Dispatch Agent', 'Ask Macro', 'Share']);
  expect(menuRows()).toEqual([
    'History',
    'Turn on wide mode',
    'Ask Macro',
    'Code Actions',
    'Share',
  ]);

  const [share] = screen
    .getAllByRole('button', { name: 'Share' })
    .filter((button) => !button.closest('menu'));
  fireEvent.click(share);
  expect(item.share).toHaveBeenCalledOnce();
});

it('leaves Dispatch Agent off a document', () => {
  item.kind = 'document';
  render(() => <MarkdownHeader collaborationStatus={() => undefined} />);

  expect(headerButtons()).toEqual(['Ask Macro', 'Share']);
  expect(screen.queryByText('Skill')).toBeNull();
});

it('marks a skill beside its title', () => {
  item.kind = 'skill';
  render(() => <MarkdownHeader collaborationStatus={() => undefined} />);

  expect(screen.getByText('Skill')).toBeTruthy();
});

it('lets an editor change the document icon', () => {
  item.kind = 'document';
  document.entity = true;
  render(() => <MarkdownHeader collaborationStatus={() => undefined} />);

  expect(screen.getByRole('img', { name: 'Change icon' })).toBeTruthy();
});

it('shows a viewer the document icon without the picker', () => {
  item.kind = 'document';
  document.entity = true;
  document.canEdit = false;
  render(() => <MarkdownHeader collaborationStatus={() => undefined} />);

  expect(screen.getByRole('img', { name: 'Document icon' })).toBeTruthy();
});
