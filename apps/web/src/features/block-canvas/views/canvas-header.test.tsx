import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasDocumentChrome } from '../component/CanvasDocument';
import { CanvasHeader } from './canvas-header';

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

const canvas = vi.hoisted(() => ({ file: undefined as Blob | undefined }));

vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => <span>2 viewing</span>,
}));
vi.mock('@core/signal/load', () => ({ blockFileSignal: () => canvas.file }));
vi.mock('./shared/canvas-header-parts', () => ({
  useCanvasHeaderTools: () => ({
    ops: [],
    openShare: () => {},
    copyLink: () => {},
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

const state = {} as CanvasDocumentChrome;

afterEach(() => {
  cleanup();
  canvas.file = undefined;
});

it('shows viewers and Ask Macro, with both rows in the title menu', () => {
  render(() => <CanvasHeader state={state} />);

  expect(screen.getByText('2 viewing')).toBeTruthy();
  expect(labels(screen.getByRole('toolbar'))).toEqual(['Ask Macro']);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});

it('shows Share once the canvas file loads', () => {
  canvas.file = new Blob();
  render(() => <CanvasHeader state={state} />);

  expect(labels(screen.getByRole('toolbar'))).toEqual(['Ask Macro', 'Share']);
});
