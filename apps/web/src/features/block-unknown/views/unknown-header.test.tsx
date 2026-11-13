import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { UnknownHeader } from './unknown-header';

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

vi.mock('@core/component/FileTypeChip', () => ({
  FileTypeChip: () => <span>ZIP </span>,
}));
vi.mock('./shared/unknown-header-parts', () => ({
  useUnknownHeaderTools: () => ({ ops: [], actions: { share: tool('Share') } }),
}));

const tool = (label: string): BlockTool => ({
  label,
  icon: () => null,
  action: () => {},
});
const labels = (element: HTMLElement) =>
  [...element.querySelectorAll('button, li')].map((node) => node.textContent);

afterEach(cleanup);

it('shows Share, with Share in the title menu', () => {
  render(() => <UnknownHeader onShare={() => {}} />);

  expect(screen.getByRole('heading').textContent).toBe('ZIP Quarterly assets');
  expect(labels(screen.getByRole('toolbar'))).toEqual(['Share']);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Share',
  ]);
});
