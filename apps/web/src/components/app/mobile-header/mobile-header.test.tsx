import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { createMutable } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '../split-layout/components/SplitHeader';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '../split-layout/context';
import { MobileHeader } from './mobile-header';

vi.mock('../side-panel', () => ({
  SidePanel: { Toggle: () => <button>Show details</button> },
  useSidePanel: () => ({ hasSections: () => true, isOpen: () => false }),
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => <span role="img" aria-label="Entity icon" />,
}));

afterEach(cleanup);

function renderPane(
  openTitleMenu?: () => void,
  title: () => JSX.Element = () => (
    <MobileHeader.Title label="Quarterly plan" iconType="md" />
  )
) {
  const [mobileView, setMobileView] = createSignal(false);
  const [displayName, setDisplayName] = createSignal('Mail');
  const layoutRefs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const panel = {
    handle: { displayName, setDisplayName },
    layoutRefs,
    mobileHeaderOwner: createSignal<symbol>(),
    titleFileMenuTrigger: () => openTitleMenu,
  } as unknown as SplitPanelContextType;

  render(() => (
    <SplitPanelContext.Provider value={panel}>
      <header>
        <div ref={(element) => (layoutRefs.headerLeft = element)} />
        <div ref={(element) => (layoutRefs.headerRight = element)} />
      </header>
      <SplitHeaderLeft>
        <span>Shared title</span>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <button>Shared action</button>
      </SplitHeaderRight>
      <Show when={mobileView()}>
        <MobileHeader trailing={<MobileHeader.Info />}>{title()}</MobileHeader>
      </Show>
    </SplitPanelContext.Provider>
  ));

  return { setMobileView, displayName };
}

it('shows only what the mobile view composes while it owns the header', () => {
  const pane = renderPane();
  expect(screen.getByRole('button', { name: 'Shared action' })).toBeTruthy();
  expect(screen.getByText('Shared title')).toBeTruthy();

  pane.setMobileView(true);
  const header = screen.getByRole('banner');
  expect(header.textContent).toBe('Quarterly planShow details');
  expect(pane.displayName()).toBe('Quarterly plan');

  pane.setMobileView(false);
  expect(screen.getByRole('button', { name: 'Shared action' })).toBeTruthy();
  expect(screen.getByText('Shared title')).toBeTruthy();
  expect(screen.queryByText('Quarterly plan')).toBeNull();
});

it('opens the title menu when the title is tapped', () => {
  const openTitleMenu = vi.fn();
  const pane = renderPane(openTitleMenu);
  pane.setMobileView(true);

  fireEvent.click(screen.getByText('Quarterly plan'));
  expect(openTitleMenu).toHaveBeenCalledOnce();
});

it('shows its own icon in place of the entity icon', () => {
  const pane = renderPane(undefined, () => (
    <MobileHeader.Title
      label="Quarterly plan"
      iconType="md"
      icon={<span role="img" aria-label="Model icon" />}
    />
  ));
  pane.setMobileView(true);

  expect(screen.getByRole('img', { name: 'Model icon' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Entity icon' })).toBeNull();
});

it('keeps the entity icon when its own icon renders nothing', () => {
  const pane = renderPane(undefined, () => (
    <MobileHeader.Title
      label="Quarterly plan"
      iconType="md"
      icon={<Show when={false}>Model icon</Show>}
    />
  ));
  pane.setMobileView(true);

  expect(screen.getByRole('img', { name: 'Entity icon' })).toBeTruthy();
});
