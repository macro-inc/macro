import {
  ViewShell,
  ViewSidebarToggle,
} from '@app/components/view-shell/ViewShell';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsNoneSelected } from './notifications-none-selected';

vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 1200, height: 800 }),
}));
vi.mock('@app/components/view-shell/create-frame-width', () => ({
  createFrameWidth: () => () => 1200,
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PANEL = {
  handle: { isFirst: () => true },
  isPanelActive: () => true,
  splitHotkeyScope: 'notifications',
} as unknown as SplitPanelContextType;

it('keeps a way back to the collapsed list while nothing is selected', () => {
  render(() => (
    <SplitPanelContext.Provider value={PANEL}>
      <ViewShell.Root asidePreferenceKey="notifications">
        <ViewShell.Aside>
          <ViewSidebarToggle action="collapse" />
        </ViewShell.Aside>
        <ViewShell.Main>
          <NotificationsNoneSelected />
        </ViewShell.Main>
      </ViewShell.Root>
    </SplitPanelContext.Provider>
  ));
  expect(screen.getByText('No notification selected')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show navigation' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  expect(screen.getByText('Notifications')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));

  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show navigation' })).toBeNull();
});
