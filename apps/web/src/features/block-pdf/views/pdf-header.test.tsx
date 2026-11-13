import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfHeader } from './pdf-header';

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

vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => <span>2 viewing</span>,
}));

const pdf = vi.hoisted(() => ({ itemType: 'document' as string | undefined }));

vi.mock('../component/PdfSplitToolbar', () => ({
  PdfSplitToolbar: () => <div role="toolbar" aria-label="Pages" />,
}));
vi.mock('./shared/pdf-header-parts', () => ({
  usePdfHeaderTools: () => ({
    itemType: pdf.itemType,
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

afterEach(() => {
  cleanup();
  pdf.itemType = 'document';
});

it('shows viewers, the page toolbar and Share, with Ask Macro in the title menu', () => {
  render(() => <PdfHeader />);

  expect(screen.getByText('2 viewing')).toBeTruthy();
  expect(screen.getByRole('toolbar', { name: 'Pages' })).toBeTruthy();
  expect(
    labels(screen.getByRole('toolbar', { name: 'Header actions' }))
  ).toEqual(['Share']);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});

it('shows nothing for a block storage does not know', () => {
  pdf.itemType = undefined;
  render(() => <PdfHeader />);

  expect(screen.queryByRole('list', { name: 'Title menu' })).toBeNull();
});
