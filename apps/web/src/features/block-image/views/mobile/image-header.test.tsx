import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileImageHeader } from './image-header';

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

vi.mock('@core/component/FileTypeChip', () => ({
  FileTypeChip: () => <span>PNG </span>,
}));
vi.mock('../shared/image-header-parts', () => ({
  useImageHeaderTools: () => ({
    ops: [],
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

it('keeps Ask Macro and Share in the title menu', () => {
  render(() => <MobileImageHeader />);

  expect(screen.getByRole('heading').textContent).toBe('PNG Quarterly assets');
  expect(labels(screen.getByRole('banner'))).toEqual([]);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});
