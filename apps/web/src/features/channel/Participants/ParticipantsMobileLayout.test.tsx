/** @vitest-environment jsdom */

import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ParticipantsMobileLayout } from './ParticipantsMobileLayout';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));

vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Tabs')),
}));

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
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
  drawerStyles.remove();
  vi.unstubAllGlobals();
});

function setup(manage = true) {
  const [request, setRequest] = createSignal(0);
  render(() => (
    <ParticipantsMobileLayout
      search={() => <input aria-label="Search participants" />}
      list={() => <div>People list</div>}
      bots={(request) => <div data-invite-request={request}>Bots list</div>}
      settings={manage ? () => <div>Team settings</div> : undefined}
      addParticipants={
        manage
          ? (done) => (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  done();
                }}
              >
                <input aria-label="People to add" />
                <button type="submit">Add selected people</button>
              </form>
            )
          : undefined
      }
      inviteBotFocusRequest={request()}
    />
  ));
  return { setRequest };
}

it('gives People, Bots, and Settings separate content areas', () => {
  setup();
  expect(screen.getByText('People list')).toBeTruthy();
  expect(screen.queryByText('Bots list')).toBeNull();
  expect(screen.queryByText('Team settings')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Bots' }));
  expect(screen.getByText('Bots list')).toBeTruthy();
  expect(screen.queryByText('People list')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Settings' }));
  expect(screen.getByText('Team settings')).toBeTruthy();
  expect(screen.queryByText('Bots list')).toBeNull();
});

it('keeps the add form out of the list and supports dismissing and reopening the sheet', async () => {
  setup();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add participants' }));
  expect(
    await screen.findByRole('dialog', { name: 'Add participants' })
  ).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'People to add' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Add participants' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add selected people' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('opens Bots for a new invite request and allows returning to People', () => {
  const { setRequest } = setup(false);
  expect(screen.queryByRole('radio', { name: 'Settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add participants' })).toBeNull();
  setRequest(1);
  expect(screen.getByText('Bots list')).toBeTruthy();
  expect(
    screen.getByText('Bots list').getAttribute('data-invite-request')
  ).toBe('1');
  fireEvent.click(screen.getByRole('radio', { name: 'People' }));
  expect(screen.getByText('People list')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Bots' }));
  expect(
    screen.getByText('Bots list').getAttribute('data-invite-request')
  ).toBe('0');
  setRequest(2);
  expect(screen.getByText('Bots list')).toBeTruthy();
  expect(
    screen.getByText('Bots list').getAttribute('data-invite-request')
  ).toBe('2');
});

it('hides the fallback accessory on People and Bots and restores it on exit', () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  FloatRegions.setMount('accessory', mount);
  render(() => (
    <FloatRegion region="accessory" priority={-1}>
      <button>AI composer</button>
    </FloatRegion>
  ));
  expect(screen.getByRole('button', { name: 'AI composer' })).toBeTruthy();
  const page = render(() => (
    <ParticipantsMobileLayout
      search={() => <input aria-label="Search participants" />}
      list={() => <div>People list</div>}
      bots={() => <div>Bots list</div>}
      inviteBotFocusRequest={0}
    />
  ));
  expect(screen.queryByRole('button', { name: 'AI composer' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Bots' }));
  expect(screen.queryByRole('button', { name: 'AI composer' })).toBeNull();
  const search = render(() => (
    <FloatRegion region="accessory" priority={100}>
      <button>Global search</button>
    </FloatRegion>
  ));
  expect(screen.getByRole('button', { name: 'Global search' })).toBeTruthy();
  search.unmount();
  expect(screen.queryByRole('button', { name: 'AI composer' })).toBeNull();
  page.unmount();
  expect(screen.getByRole('button', { name: 'AI composer' })).toBeTruthy();
  cleanup();
  mount.remove();
});
