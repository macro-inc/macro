import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createContext, createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';

const mocks = vi.hoisted(() => ({ touch: false, width: 1400 }));
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
  const ResizeZoneContext = createContext({ size: (): number => 1400 });
  return {
    ResizeZoneContext,
    Resize: {
      Zone: (props: ParentProps) => (
        <ResizeZoneContext.Provider value={{ size: () => mocks.width }}>
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
  mocks.width = 1400;
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

function setup() {
  render(() => (
    <SidePanel.Root floating defaultOpen={false}>
      <SidePanel.Toggle />
      <SidePanel.Layout floating headerToggle={false}>
        <p>Document content</p>
        <SidePanel.Section id="properties" title="Properties" defaultOpen>
          <button>Edit property</button>
        </SidePanel.Section>
        <SidePanel.Footer>Owned by Sam</SidePanel.Footer>
      </SidePanel.Layout>
    </SidePanel.Root>
  ));
}

it('opens a wide floating panel beside the content', () => {
  render(() => (
    <SidePanel.Root floating defaultOpen={false}>
      <SidePanel.Layout floating besideWhenWide headerToggle={false}>
        <p>Document content</p>
        <SidePanel.Section id="properties" title="Properties" defaultOpen>
          <button>Edit property</button>
        </SidePanel.Section>
      </SidePanel.Layout>
    </SidePanel.Root>
  ));
  const beside = document.querySelector('[data-side-panel-beside]');
  expect(beside).toBeTruthy();
  expect(beside?.getAttribute('style')).toContain('padding-right');
  expect(
    screen.getByRole('complementary', { name: 'Block details' })
  ).toBeTruthy();
  expect(screen.getByText('Document content')).toBeTruthy();
});

it('keeps a narrow floating panel closed', () => {
  mocks.width = 800;
  render(() => (
    <SidePanel.Root floating defaultOpen={false}>
      <SidePanel.Layout floating besideWhenWide headerToggle={false}>
        <p>Document content</p>
        <SidePanel.Section id="properties" title="Properties" defaultOpen>
          <button>Edit property</button>
        </SidePanel.Section>
      </SidePanel.Layout>
    </SidePanel.Root>
  ));
  expect(document.querySelector('[data-side-panel-beside]')).toBeNull();
  expect(
    screen.queryByRole('complementary', { name: 'Block details' })
  ).toBeNull();
});

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
