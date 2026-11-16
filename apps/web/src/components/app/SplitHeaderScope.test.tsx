import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { createMutable } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileHeader } from './mobile-header/mobile-header';
import { SplitHeaderScope, useSplitHeaderScope } from './SplitHeaderScope';
import { SplitHeaderLeft } from './split-layout/components/SplitHeader';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';

vi.mock('./side-panel', () => ({
  SidePanel: { Toggle: () => <button>Show details</button> },
  useSidePanel: () => ({ hasSections: () => true, isOpen: () => false }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('../priority-collapse/PriorityCollapseOverflowSensor', () => ({
  createPriorityCollapseController: () => ({
    setRow: () => {},
    collapser: {},
  }),
  PriorityCollapseOverflowSensor: () => null,
}));

afterEach(cleanup);

/** The hosting pane's bar: the slots a `SplitHeaderScope.TopBar` registers. */
function HostedBar() {
  const scope = useSplitHeaderScope();
  return (
    <header aria-label="Hosted header">
      <div ref={(element) => scope?.setLayoutRef('headerLeft', element)} />
      <div ref={(element) => scope?.setLayoutRef('headerRight', element)} />
    </header>
  );
}

function splitPanel() {
  const [displayName, setDisplayName] = createSignal('Tasks');
  const layoutRefs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const panel = {
    handle: { displayName, setDisplayName },
    layoutRefs,
    mobileHeaderOwner: createSignal<symbol>(),
    titleFileMenuTrigger: () => undefined,
  } as unknown as SplitPanelContextType;
  return { panel, layoutRefs };
}

it('hosts a mobile view’s header in the pane’s bar and leaves the split’s header alone', () => {
  const { panel, layoutRefs } = splitPanel();
  const [mobileView, setMobileView] = createSignal(false);

  render(() => (
    <SplitPanelContext.Provider value={panel}>
      <header aria-label="Split header">
        <div ref={(element) => (layoutRefs.headerLeft = element)} />
      </header>
      <SplitHeaderLeft>
        <span>Tasks list</span>
      </SplitHeaderLeft>
      <SplitHeaderScope.Root>
        <HostedBar />
        <SplitHeaderLeft>
          <span>Breadcrumbs</span>
        </SplitHeaderLeft>
        <Show when={mobileView()}>
          <MobileHeader trailing={<MobileHeader.Info />}>
            <MobileHeader.Title label="Quarterly plan" />
          </MobileHeader>
        </Show>
      </SplitHeaderScope.Root>
    </SplitPanelContext.Provider>
  ));

  const hosted = screen.getByRole('banner', { name: 'Hosted header' });
  const split = screen.getByRole('banner', { name: 'Split header' });
  expect(hosted.textContent).toBe('Breadcrumbs');

  setMobileView(true);
  expect(hosted.textContent).toBe('Quarterly planShow details');
  expect(
    within(hosted).getByRole('button', { name: 'Show details' })
  ).toBeTruthy();
  expect(split.textContent).toBe('Tasks list');

  setMobileView(false);
  expect(hosted.textContent).toBe('Breadcrumbs');
});

it('answers for the nearest host only', () => {
  const { panel } = splitPanel();
  const [hosting, setHosting] = createSignal(false);
  const Detail = () => (
    <output>{useSplitHeaderScope() ? 'hosted header' : 'own bar'}</output>
  );

  render(() => (
    <SplitPanelContext.Provider value={panel}>
      {/* An inline preview frame around a view that hosts a detail. */}
      <SplitHeaderScope.Root>
        <SplitHeaderScope.Root when={hosting()}>
          <Detail />
        </SplitHeaderScope.Root>
      </SplitHeaderScope.Root>
    </SplitPanelContext.Provider>
  ));

  expect(screen.getByRole('status').textContent).toBe('own bar');

  setHosting(true);
  expect(screen.getByRole('status').textContent).toBe('hosted header');
});
