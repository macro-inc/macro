import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeHeader } from './code-header';

vi.mock('@components/app/block-toolbar', () => ({
  BlockToolbar: (props: {
    tools?: BlockTool[];
    trailing?: JSX.Element;
    menuTools: BlockTool[];
  }) => (
    <>
      <div role="toolbar" aria-label="Header actions">
        <For each={props.tools}>
          {(tool) => <button>{tool.label as string}</button>}
        </For>
        {props.trailing}
      </div>
      <menu aria-label="Title menu">
        <For each={props.menuTools}>
          {(tool) => <li>{tool.label as string}</li>}
        </For>
      </menu>
    </>
  ),
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => props.children,
  SplitHeaderRight: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  BlockItemSplitLabel: (props: { badges?: JSX.Element }) => (
    <h1>
      {props.badges}
      Quarterly assets
    </h1>
  ),
  SplitPermissionsBadge: () => null,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'doc-1' }));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => 'Quarterly assets',
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => <button>Share</button>,
}));

vi.mock('../component/CodeFileTypeChip', () => ({
  CodeFileTypeChip: () => <span>TS </span>,
}));
vi.mock('../component/CodeModeControl', () => ({
  CodeModeControl: () => <button>Preview</button>,
}));
vi.mock('./shared/code-header-parts', () => ({
  useCodeHeaderTools: () => ({
    ops: [],
    openShare: () => {},
    actions: { askMacro: tool('Ask Macro'), share: tool('Share') },
  }),
}));

const tool = (label: string): BlockTool => ({
  label,
  icon: () => null,
  action: () => {},
});
const labels = (element: HTMLElement) =>
  [...element.querySelectorAll('button, li')].map((node) => node.textContent);

afterEach(cleanup);

it('shows Ask Macro and Share, with both in the title menu', () => {
  render(() => (
    <CodeHeader isHtmlFile={false} mode="code" onModeChange={() => {}} />
  ));

  expect(screen.getByRole('heading').textContent).toBe('TS Quarterly assets');
  expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
  expect(labels(screen.getByRole('toolbar'))).toEqual(['Ask Macro', 'Share']);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});

it('shows the view mode for an HTML file', () => {
  render(() => <CodeHeader isHtmlFile mode="code" onModeChange={() => {}} />);

  expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
});
