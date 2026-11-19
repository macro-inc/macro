import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NavigationHostContext } from './navigation-host';
import { ViewShell } from './ViewShell';
import { ViewSidebar } from './ViewSidebar';

const measurement = vi.hoisted(() => ({ touch: (): boolean => false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => measurement.touch(),
}));

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  activateScopeOnFocusIn: vi.fn(),
}));

vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 1200, height: 800 }),
}));

vi.mock('./create-frame-width', () => ({
  createFrameWidth: () => () => 1200,
}));

vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/utils/press')),
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button aria-label={props['aria-label']} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  measurement.touch = () => false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Split(props: { app: string; active: () => boolean; list?: boolean }) {
  return (
    <SplitPanelContext.Provider
      value={
        {
          handle: { isFirst: () => true },
          isPanelActive: props.active,
          splitHotkeyScope: props.app,
        } as unknown as SplitPanelContextType
      }
    >
      <ViewShell.Root
        asidePreferenceKey={props.app}
        asideList={props.list ? { open: false, onBack: () => {} } : undefined}
        data-testid={props.app}
      >
        <ViewShell.Aside>
          <ViewSidebar.Root aria-label={`${props.app} navigation`}>
            <ViewSidebar.Header>
              <ViewSidebar.Title>{props.app}</ViewSidebar.Title>
            </ViewSidebar.Header>
          </ViewSidebar.Root>
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.TopBar />
        </ViewShell.Main>
      </ViewShell.Root>
    </SplitPanelContext.Provider>
  );
}

function setup(hostActive: () => boolean, tasksIsList = false) {
  const [activeSplit, setActiveSplit] = createSignal('email');
  const [slot, setSlot] = createSignal<HTMLElement>();
  const view = render(() => (
    <NavigationHostContext.Provider value={{ active: hostActive, slot }}>
      <div ref={setSlot} data-testid="slot" />
      <Split app="email" active={() => activeSplit() === 'email'} />
      <Split
        app="tasks"
        active={() => activeSplit() === 'tasks'}
        list={tasksIsList}
      />
    </NavigationHostContext.Provider>
  ));
  return { ...view, setActiveSplit };
}

it("shows only the active split's navigation, in the single sidebar", () => {
  const view = setup(() => true);
  const slot = within(view.getByTestId('slot'));
  expect(slot.getByRole('complementary', { name: 'email navigation' }));
  expect(
    screen.queryByRole('complementary', { name: 'tasks navigation' })
  ).toBeNull();
  // The split itself has no navigation column left to hide or show.
  expect(screen.queryByRole('button', { name: 'Hide navigation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show navigation' })).toBeNull();

  view.setActiveSplit('tasks');
  expect(slot.getByRole('complementary', { name: 'tasks navigation' }));
  expect(
    screen.queryByRole('complementary', { name: 'email navigation' })
  ).toBeNull();
});

it('keeps navigation in each split while the single sidebar is off', () => {
  const [hostActive, setHostActive] = createSignal(false);
  const view = setup(hostActive);
  const email = within(view.getByTestId('email'));
  const tasks = within(view.getByTestId('tasks'));
  expect(email.getByRole('complementary', { name: 'email navigation' }));
  expect(tasks.getByRole('complementary', { name: 'tasks navigation' }));
  expect(view.getByTestId('slot').childElementCount).toBe(0);

  setHostActive(true);
  expect(
    within(view.getByTestId('slot')).getByRole('complementary', {
      name: 'email navigation',
    })
  );
  expect(
    email.queryByRole('complementary', { name: 'email navigation' })
  ).toBeNull();
});

it('keeps touch navigation in its split', () => {
  measurement.touch = () => true;
  const view = setup(() => true);
  expect(view.getByTestId('slot').childElementCount).toBe(0);
  expect(
    within(view.getByTestId('email')).getByRole('complementary', {
      name: 'email navigation',
    })
  );
});

it("keeps a view's list in its split, active or not", () => {
  const view = setup(() => true, true);
  const tasks = within(view.getByTestId('tasks'));
  expect(tasks.getByRole('complementary', { name: 'tasks navigation' }));

  view.setActiveSplit('tasks');
  expect(tasks.getByRole('complementary', { name: 'tasks navigation' }));
  expect(view.getByTestId('slot').childElementCount).toBe(0);
});
