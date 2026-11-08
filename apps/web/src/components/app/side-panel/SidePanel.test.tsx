import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import {
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
} from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';

const mocks = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.touch }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/block', () => ({ useMaybeBlockAliasedName: () => undefined }));
vi.mock('@app/preferences/use-preference', () => ({
  usePreference: (_key: string, options: { default: boolean }) =>
    createSignal(options.default),
}));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('../split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('../split-layout/components/SplitHeader', () => ({
  SplitHeaderRight: (props: ParentProps) => props.children,
}));
vi.mock('../split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/Resize/Resize', () => {
  const ResizeZoneContext = createContext({ size: () => 1400 });
  return {
    ResizeZoneContext,
    Resize: {
      Zone: (props: ParentProps) => (
        <ResizeZoneContext.Provider value={{ size: () => 1400 }}>
          {props.children}
        </ResizeZoneContext.Provider>
      ),
      Panel: (props: ParentProps) => <main>{props.children}</main>,
    },
  };
});

let motion: HTMLStyleElement;
beforeEach(() => {
  mocks.touch = false;
  motion = document.createElement('style');
  motion.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(motion);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motion.remove();
  vi.unstubAllGlobals();
});

function setup(props?: {
  floating?: boolean;
  defaultOpen?: boolean;
  narrowThreshold?: number;
  panel?: (sections: JSX.Element) => JSX.Element;
  onOpenChange?: (open: boolean) => void;
}) {
  render(() => (
    <SidePanel.Root
      floating={props?.floating ?? true}
      defaultOpen={props?.defaultOpen ?? false}
      onOpenChange={props?.onOpenChange}
    >
      <SidePanel.Toggle />
      <SidePanel.Layout
        floating={props?.floating ?? true}
        headerToggle={false}
        narrowThreshold={props?.narrowThreshold}
        panel={props?.panel}
      >
        <p>Document content</p>
        <SidePanel.Section id="properties" title="Properties" defaultOpen>
          <button>Edit property</button>
        </SidePanel.Section>
        <SidePanel.Footer>Owned by Sam</SidePanel.Footer>
      </SidePanel.Layout>
    </SidePanel.Root>
  ));
}

it('opens touch details in the standard drawer and dismisses with Escape', async () => {
  mocks.touch = true;
  setup();
  const trigger = screen.getByRole('button', { name: 'Show details' });
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  const drawer = screen.getByRole('dialog', { name: 'Item details' });
  expect(drawer.querySelector('[data-drawer-scroll-body]')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit property' })).toBeTruthy();
  expect(screen.getByText('Owned by Sam')).toBeTruthy();
  expect(
    screen.queryByRole('complementary', { name: 'Block details' })
  ).toBeNull();
  fireEvent.keyDown(drawer, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen
      .getByRole('button', { name: 'Show details' })
      .getAttribute('aria-expanded')
  ).toBe('false');
});

it('composes custom content around the sections in a wide panel', () => {
  setup({
    floating: false,
    defaultOpen: true,
    panel: (sections) => (
      <div data-testid="custom-panel">
        <p>Extra details</p>
        {sections}
      </div>
    ),
  });

  const panel = screen.getByTestId('custom-panel');
  expect(panel.textContent).toContain('Extra details');
  expect(
    panel.contains(screen.getByRole('button', { name: 'Edit property' }))
  ).toBe(true);
  expect(screen.queryByText('Back to content')).toBeNull();
});

it('uses the supplied threshold to show the overlay and keeps its back control', () => {
  setup({
    floating: false,
    narrowThreshold: 1500,
    panel: (sections) => (
      <div data-testid="custom-panel">
        <p>Extra details</p>
        {sections}
      </div>
    ),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(screen.getByTestId('custom-panel').textContent).toContain(
    'Edit property'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back to content' }));
  expect(screen.queryByTestId('custom-panel')).toBeNull();
  expect(screen.getByText('Document content')).toBeTruthy();
});

it('keeps custom content and standard sections inside the touch scroll body', () => {
  mocks.touch = true;
  setup({
    panel: (sections) => (
      <div data-testid="custom-panel">
        <p>Extra details</p>
        {sections}
      </div>
    ),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  const scrollBody = screen
    .getByRole('dialog')
    .querySelector('[data-drawer-scroll-body]');
  expect(scrollBody?.contains(screen.getByTestId('custom-panel'))).toBe(true);
  expect(scrollBody?.textContent).toContain('Extra details');
  expect(scrollBody?.textContent).toContain('Edit property');
});

it('composes custom content around floating sections', () => {
  setup({
    panel: (sections) => (
      <div data-testid="custom-panel">
        <p>Extra details</p>
        {sections}
      </div>
    ),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(
    screen.getByRole('complementary', { name: 'Block details' }).textContent
  ).toContain('Extra details');
  expect(screen.getByTestId('custom-panel').textContent).toContain(
    'Edit property'
  );
});

it('notifies its owner when the floating panel opens and closes', () => {
  const onOpenChange = vi.fn();
  setup({ onOpenChange });
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
  expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
});
