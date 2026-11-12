import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileMarkdownHeader } from './markdown-header';

const device = vi.hoisted(() => ({ phone: true }));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.phone }));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_MARKDOWN_SIDE_PANEL: true,
}));
vi.mock('@components/app/mobile-header/mobile-header', () => {
  const MobileHeader = (props: {
    children: JSX.Element;
    trailing?: JSX.Element;
  }) => (
    <header>
      {props.children}
      {props.trailing}
    </header>
  );
  MobileHeader.Title = (props: { label: string }) => <h1>{props.label}</h1>;
  MobileHeader.Island = (props: { children: JSX.Element }) => (
    <>{props.children}</>
  );
  MobileHeader.Info = () => <button>Show details</button>;
  return { MobileHeader };
});
vi.mock('@components/app/CollaborationStatusIndicator', () => ({
  CollaborationStatusIndicator: () => null,
  isCollaborationStatusVisible: () => false,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitPermissionsBadge: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: { tools: BlockTool[] }) => (
    <menu aria-label="Document actions">
      <For each={props.tools}>
        {(tool) => (
          <li>
            <button>{tool.label as string}</button>
          </li>
        )}
      </For>
    </menu>
  ),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => <button>Ask Macro</button>,
}));
vi.mock('../../component/DispatchAgentMenu', () => ({
  DispatchAgentButton: () => <button>Dispatch Agent</button>,
}));
vi.mock('../../component/MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Ship the release' }),
}));
vi.mock('../../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'task-1',
    kind: () => 'task',
  }),
}));
vi.mock('../../component/useMarkdownDocumentTools', () => ({
  useMarkdownDocumentTools: () => {
    const action = (label: string) => ({
      label,
      icon: () => null,
      action: () => {},
    });
    return {
      fileOperations: [],
      actions: {
        history: action('History'),
        askMacro: action('Ask Macro'),
        codeActions: action('Code Actions'),
        share: action('Share'),
      },
    };
  },
}));

afterEach(() => {
  cleanup();
  device.phone = true;
});

const names = (container: HTMLElement) =>
  within(container)
    .getAllByRole('button')
    .map((button) => button.textContent);

it('keeps History and Dispatch Agent off a phone', () => {
  render(() => <MobileMarkdownHeader collaborationStatus={() => undefined} />);

  expect(
    screen.getByRole('heading', { name: 'Ship the release' })
  ).toBeTruthy();
  expect(names(screen.getByRole('banner'))).toEqual([
    'Ask Macro',
    'Show details',
  ]);
  expect(names(screen.getByRole('list', { name: 'Document actions' }))).toEqual(
    ['Ask Macro', 'Code Actions', 'Share']
  );
});

it('offers History and Dispatch Agent on a tablet', () => {
  device.phone = false;
  render(() => <MobileMarkdownHeader collaborationStatus={() => undefined} />);

  expect(names(screen.getByRole('banner'))).toEqual([
    'Dispatch Agent',
    'Ask Macro',
    'Show details',
  ]);
  expect(names(screen.getByRole('list', { name: 'Document actions' }))).toEqual(
    ['History', 'Ask Macro', 'Code Actions', 'Share']
  );
});
