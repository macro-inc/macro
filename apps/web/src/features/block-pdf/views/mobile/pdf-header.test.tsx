import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobilePdfHeader } from './pdf-header';

vi.mock('@components/app/mobile-header/mobile-block-header', () => ({
  MobileBlockHeader: (props: {
    badges?: JSX.Element;
    children?: JSX.Element;
    trailing?: JSX.Element;
    menuTools: BlockTool[];
  }) => (
    <>
      <header>
        <h1>
          {props.badges}
          Quarterly assets
        </h1>
        {props.children}
        {props.trailing}
      </header>
      <menu aria-label="Title menu">
        <For each={props.menuTools}>
          {(tool) => <li>{tool.label as string}</li>}
        </For>
      </menu>
    </>
  ),
}));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: {
    Island: (props: { children: JSX.Element }) => props.children,
  },
}));

vi.mock('@core/block', () => ({ useBlockId: () => 'doc-1' }));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => 'Quarterly assets',
}));
vi.mock('@core/signal/load', () => ({
  blockMetadataSignal: () => ({ fileType: 'pdf' }),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => <button>Ask Macro</button>,
}));

const pdf = vi.hoisted(() => ({ itemType: 'document' as string | undefined }));

vi.mock('../../component/PdfSplitToolbar', () => ({
  PdfSplitToolbar: () => <div role="toolbar" aria-label="Pages" />,
}));
vi.mock('../shared/pdf-header-parts', () => ({
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

it('keeps Ask Macro in the header, the page toolbar, and both rows in the title menu', () => {
  render(() => <MobilePdfHeader />);

  expect(labels(screen.getByRole('banner'))).toEqual(['Ask Macro']);
  expect(screen.getByRole('toolbar', { name: 'Pages' })).toBeTruthy();
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});

it('shows nothing for a block storage does not know', () => {
  pdf.itemType = undefined;
  render(() => <MobilePdfHeader />);

  expect(screen.queryByRole('banner')).toBeNull();
});
