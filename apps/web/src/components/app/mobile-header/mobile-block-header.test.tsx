import type { BlockTool } from '@components/app/block-tool';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { createMutable } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { SplitPanelContextType } from '../split-layout/context';
import { SplitPanelContext } from '../split-layout/context';
import { MobileBlockHeader } from './mobile-block-header';

const block = vi.hoisted(() => ({ name: 'unknown', fileType: 'zip' }));

vi.mock('@core/block', () => ({
  useBlockId: () => 'doc-1',
  useBlockAliasedName: () => block.name,
}));
vi.mock('@core/signal/load', () => ({
  blockMetadataSignal: () => ({ fileType: block.fileType }),
}));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => 'Quarterly assets',
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <span role="img" aria-label={`${props.targetType} icon`} />
  ),
}));
vi.mock('../side-panel', () => ({
  SidePanel: { Toggle: () => <button>Show details</button> },
  useSidePanel: () => ({ hasSections: () => true, isOpen: () => false }),
}));
vi.mock('../split-layout/components/SplitLabel', () => ({
  SplitPermissionsBadge: () => <span>View only</span>,
}));
vi.mock('../split-layout/components/SplitFileMenu', () => ({
  BlockSplitFileMenu: (props: { tools: BlockTool[]; name: string }) => (
    <menu aria-label={`${props.name} actions`}>
      <For each={props.tools}>
        {(tool) => <li>{tool.label as string}</li>}
      </For>
    </menu>
  ),
}));

afterEach(() => {
  cleanup();
  block.name = 'unknown';
});

function renderHeader() {
  const openTitleMenu = vi.fn();
  const layoutRefs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const [displayName, setDisplayName] = createSignal('');
  const panel = {
    handle: { displayName, setDisplayName },
    layoutRefs,
    mobileHeaderOwner: createSignal<symbol>(),
    titleFileMenuTrigger: () => openTitleMenu,
  } as unknown as SplitPanelContextType;
  const tool = (label: string): BlockTool => ({
    label,
    icon: () => null,
    action: () => {},
  });

  render(() => (
    <SplitPanelContext.Provider value={panel}>
      <header>
        <div ref={(element) => (layoutRefs.headerLeft = element)} />
        <div ref={(element) => (layoutRefs.headerRight = element)} />
      </header>
      <MobileBlockHeader
        badges={<span>ZIP</span>}
        menuTools={[tool('Ask Macro'), tool('Share')]}
        ops={[]}
        trailing={<button>Download</button>}
      >
        <button>View mode</button>
      </MobileBlockHeader>
    </SplitPanelContext.Provider>
  ));

  return { openTitleMenu };
}

it('composes the title, the block islands, the permissions badge and Info', () => {
  renderHeader();

  expect(screen.getByRole('banner').textContent).toBe(
    'ZIPQuarterly assetsView modeView onlyDownloadShow details'
  );
  expect(screen.getByRole('img', { name: 'zip icon' })).toBeTruthy();
  expect(
    screen.getByRole('list', { name: 'Quarterly assets actions' }).textContent
  ).toBe('Ask MacroShare');
});

it('names the icon after the block for known file types', () => {
  block.name = 'pdf';
  renderHeader();

  expect(screen.getByRole('img', { name: 'pdf icon' })).toBeTruthy();
});

it('opens the title menu when the title is tapped', () => {
  const { openTitleMenu } = renderHeader();

  fireEvent.click(screen.getByText('Quarterly assets'));
  expect(openTitleMenu).toHaveBeenCalledOnce();
});
