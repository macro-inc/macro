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

const mocks = vi.hoisted(() => ({
  touch: false,
  width: 1400,
  preferences: new Map<string, boolean>(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.touch }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/block', () => ({ useMaybeBlockAliasedName: () => undefined }));
vi.mock('@app/preferences/use-preference', () => ({
  usePreference: (key: string, options: { default: boolean }) => {
    const [value, setValue] = createSignal(
      mocks.preferences.get(key) ?? options.default
    );
    return [
      value,
      (next: boolean | ((previous: boolean) => boolean)) => {
        const result = setValue(next);
        mocks.preferences.set(key, result);
        return result;
      },
    ];
  },
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
  const ResizeZoneContext = createContext({ size: () => mocks.width });
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
  mocks.preferences.clear();
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

function setup(persistentFloating = false, unseenCount = 0) {
  render(() => (
    <SidePanel.Root
      floating
      persistentFloating={persistentFloating}
      defaultOpen={false}
      persistKey="test-agent"
    >
      <SidePanel.Toggle unseenCount={unseenCount} />
      <SidePanel.Layout
        floating
        persistentFloating={persistentFloating}
        headerToggle={false}
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

it('keeps an opted-in wide floating panel open on outside click and remembers it', () => {
  setup(true, 3);
  expect(screen.getByLabelText('3 unseen items')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  expect(screen.queryByLabelText('3 unseen items')).toBeNull();
  expect(
    screen.queryByRole('complementary', { name: 'Block details' })
  ).toBeTruthy();
  expect(document.querySelector('[data-side-panel-scrim]')).toBeNull();
  fireEvent.click(screen.getByText('Document content'));
  expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy();
  cleanup();
  setup(true);
  expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy();
});

it('closes an opted-in floating panel outside below 900px', () => {
  mocks.width = 899;
  setup(true);
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  const scrim = document.querySelector('[data-side-panel-scrim]');
  expect(scrim).toBeTruthy();
  fireEvent.click(scrim!);
  expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
});

it('retains outside-click dismissal for ordinary floating panels', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  const scrim = document.querySelector('[data-side-panel-scrim]');
  expect(scrim).toBeTruthy();
  fireEvent.click(scrim!);
  expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
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
