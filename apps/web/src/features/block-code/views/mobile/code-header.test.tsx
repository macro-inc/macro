import type { BlockTool } from '@components/app/block-tool';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileCodeHeader } from './code-header';

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

const device = vi.hoisted(() => ({ phone: true }));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.phone }));

vi.mock('../../component/CodeFileTypeChip', () => ({
  CodeFileTypeChip: () => <span>TS </span>,
}));
vi.mock('../../component/CodeModeControl', () => ({
  CodeModeControl: () => <button>Preview</button>,
}));
vi.mock('../shared/code-header-parts', () => ({
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

afterEach(() => {
  cleanup();
  device.phone = true;
});

it('keeps Ask Macro and Share in the title menu', () => {
  render(() => (
    <MobileCodeHeader isHtmlFile={false} mode="code" onModeChange={() => {}} />
  ));

  expect(screen.getByRole('heading').textContent).toBe('TS Quarterly assets');
  expect(labels(screen.getByRole('banner'))).toEqual([]);
  expect(labels(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'Ask Macro',
    'Share',
  ]);
});

it('shows the view mode for an HTML file on a tablet only', () => {
  render(() => (
    <MobileCodeHeader isHtmlFile mode="code" onModeChange={() => {}} />
  ));
  expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
  cleanup();

  device.phone = false;
  render(() => (
    <MobileCodeHeader isHtmlFile mode="code" onModeChange={() => {}} />
  ));
  expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
});
