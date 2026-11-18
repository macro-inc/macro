import 'fake-indexeddb/auto';
import {
  createTouchTopBarInset,
  TouchTopBarInsetProvider,
} from '@app/components/view-shell/touch-top-bar';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SplitHeaderScope } from '../SplitHeaderScope';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '../split-layout/context';
import { MobileHeader } from './mobile-header';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('../split-layout/components/SplitHeaderContextMenu', () => ({
  SplitHeaderContextMenu: (props: ParentProps) => props.children,
}));
vi.mock('../../priority-collapse/PriorityCollapseOverflowSensor', () => ({
  createPriorityCollapseController: () => ({
    setRow: () => {},
    collapser: {},
  }),
  PriorityCollapseOverflowSensor: (props: {
    contentRef: (element: HTMLDivElement) => void;
  }) => <div ref={props.contentRef} />,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: (element: () => HTMLElement | undefined) => ({
    get height() {
      return element() ? 60 : undefined;
    },
    width: 390,
  }),
}));

afterEach(cleanup);

it('registers project islands and their inset in the owning pane and retires them on exit', () => {
  const inset = createTouchTopBarInset();
  const [open, setOpen] = createSignal(true);
  const [displayName, setDisplayName] = createSignal('Tasks');
  const panel = {
    handle: { displayName, setDisplayName },
  } as unknown as SplitPanelContextType;

  render(() => (
    <SplitPanelContext.Provider value={panel}>
      <TouchTopBarInsetProvider value={inset.value}>
        <Show when={open()}>
          <SplitHeaderScope.Pane>
            <MobileHeader
              trailing={
                <MobileHeader.Island>
                  <button>Project details</button>
                </MobileHeader.Island>
              }
            >
              <MobileHeader.Title label="Project" />
            </MobileHeader>
            <p>Project content</p>
          </SplitHeaderScope.Pane>
        </Show>
      </TouchTopBarInsetProvider>
    </SplitPanelContext.Provider>
  ));

  const details = screen.getByRole('button', { name: 'Project details' });
  const header = details.closest('[data-view-shell-top-bar]');
  expect(header).not.toBeNull();
  expect(header?.textContent).toContain('Project');
  expect(header?.contains(screen.getByText('Project content'))).toBe(false);
  expect(inset.height()).toBe(60);
  expect(panel.layoutRefs).toBeUndefined();

  setOpen(false);
  expect(inset.height()).toBe(0);
});
