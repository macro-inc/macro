/** @vitest-environment jsdom */
import type { HotkeyInterceptorContext } from '@core/hotkey/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCallCommand } from '../create-call-command';
import { SidebarCreateMenu } from './sidebar-create-menu';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  close: vi.fn(),
  calls: true,
  enabled: undefined as (() => boolean) | undefined,
  interceptor: undefined as
    | ((context: HotkeyInterceptorContext) => boolean)
    | undefined,
}));
vi.mock('@app/features/command/Launcher', () => ({
  useCreateMenuBlocks: () => () => {
    const command = createCallCommand({
      ...mocks,
      enabled: () => mocks.enabled?.() ?? mocks.calls,
    });
    return command.enabled?.() ? [command] : [];
  },
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/hotkeyRoot', () => ({
  useHotkeyInterceptor: (interceptor: typeof mocks.interceptor) => {
    mocks.interceptor = interceptor;
  },
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Dropdown')),
  Hotkey: () => null,
}));

let style: HTMLStyleElement;
beforeEach(() => {
  mocks.calls = true;
  mocks.enabled = undefined;
  vi.clearAllMocks();
  style = document.createElement('style');
  style.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(style);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  style.remove();
  vi.unstubAllGlobals();
});

async function openMenu() {
  render(() => (
    <SidebarCreateMenu
      trigger={(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>Create</button>
      )}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Create' }), {
    key: 'Enter',
  });
  await screen.findByRole('menu');
}

function intercept(key: 'c' | 'escape', editable = false) {
  return mocks.interceptor?.({
    pressedKeysString: key,
    pressedKeys: new Set([key]),
    event: new KeyboardEvent('keydown', { key }),
    activeScopeId: 'global',
    isEditableFocused: editable,
    eventType: 'keydown',
  });
}

it('offers Call in the shared Create menu and navigates without creating it', async () => {
  await openMenu();
  fireEvent.pointerUp(screen.getByRole('menuitem', { name: 'Call' }), {
    button: 0,
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
});

it('uses C for Call instead of closing the sidebar Create menu', async () => {
  await openMenu();
  expect(intercept('c')).toBe(true);
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
});

it('leaves typing alone and keeps Escape available to close', async () => {
  await openMenu();
  expect(intercept('c', true)).toBe(false);
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(intercept('escape')).toBe(true);
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('retains C to close and hides Call when calls are disabled', async () => {
  mocks.calls = false;
  await openMenu();
  expect(screen.queryByRole('menuitem', { name: 'Call' })).toBeNull();
  expect(intercept('c')).toBe(true);
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('adds Call to an open menu after flag loading completes', async () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.enabled = enabled;
  await openMenu();
  expect(screen.queryByRole('menuitem', { name: 'Call' })).toBeNull();
  setEnabled(true);
  expect(await screen.findByRole('menuitem', { name: 'Call' })).toBeTruthy();
  expect(intercept('c')).toBe(true);
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/meet/new');
});
