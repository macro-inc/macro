import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { BlockTool } from './block-tool';
import { BlockToolbar } from './block-toolbar';

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  ButtonGroup: (await import('@app/components/ui/components/ButtonGroup'))
    .ButtonGroup,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./split-layout/components/SplitHeader', () => ({
  SplitHeaderRight: (props: { children: JSX.Element }) => (
    <header>{props.children}</header>
  ),
}));
vi.mock('./split-layout/components/SplitLabel', () => ({
  SplitTitleFileMenu: (props: { children: JSX.Element }) => (
    <>{props.children}</>
  ),
}));
vi.mock('./split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: { tools: BlockTool[] }) => (
    <menu aria-label="Title menu">
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
vi.mock('./side-panel', () => ({
  SidePanel: { HeaderActionsOutlet: () => <button>Ask Macro</button> },
}));

afterEach(cleanup);

const tool = (label: string, action = () => {}): BlockTool => ({
  label,
  icon: () => null,
  action,
});

const names = (container: HTMLElement) =>
  within(container)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);

it('orders tools, the side panel actions, then the trailing controls', () => {
  const download = vi.fn();

  render(() => (
    <BlockToolbar
      tools={[
        tool('Download', download),
        { ...tool('Present'), condition: () => false },
      ]}
      trailing={<button>Share</button>}
      menuTools={[tool('History'), tool('Share')]}
      ops={[]}
      id="doc-1"
      itemType="document"
      name="Plan"
    />
  ));

  expect(names(screen.getByRole('banner'))).toEqual([
    'Download',
    'Ask Macro',
    'Share',
  ]);
  expect(
    within(screen.getByRole('group', { name: 'Document actions' })).getByRole(
      'button',
      { name: 'Download' }
    )
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(download).toHaveBeenCalledOnce();

  expect(names(screen.getByRole('list', { name: 'Title menu' }))).toEqual([
    'History',
    'Share',
  ]);
});

it('draws no tool group when no tool applies', () => {
  render(() => (
    <BlockToolbar
      tools={[{ ...tool('Present'), condition: () => false }]}
      trailing={<button>Share</button>}
      menuTools={[]}
      ops={[]}
      id="doc-1"
      itemType="document"
      name="Plan"
    />
  ));

  expect(screen.queryByRole('group', { name: 'Document actions' })).toBeNull();
  expect(names(screen.getByRole('banner'))).toEqual(['Ask Macro', 'Share']);
});
