import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScreenCapabilities } from '../context/screen-context';
import { createScreenInput } from '../primitives/screen-input';
import { createScreenSession } from '../primitives/screen-session';
import type { ScreenSessionHandlers, ScreenState } from '../transports/types';
import { AgentScreen } from './agent-screen';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: () => {} }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: () => null,
  SplitHeaderRight: () => null,
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setActiveScope('global');
  setPressedKeys(new Set<string>());
  vi.useRealTimers();
});

const ALICE = { userId: 'user-alice', name: 'Alice' };

function state(drivingHere: boolean): ScreenState {
  return {
    driver: ALICE,
    agentHeld: true,
    waking: false,
    transport: 'vnc',
    viewers: 1,
    drivingHere,
  };
}

describe('AgentScreen while a drive drops', () => {
  it("keeps the keyboard and the driver's controls from the end, through reconnecting, until live again", async () => {
    vi.useFakeTimers();
    // The app's real hotkey root, with Search on "/" as in the app.
    const openSearch = vi.fn(() => true);
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot();
      registerHotkey({
        scopeId: 'global',
        hotkey: '/',
        description: 'Search',
        runWithInputFocused: true,
        keyDownHandler: openSearch,
      });
    });

    const connections: ScreenSessionHandlers[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async (_element, _ticket, handlers) => {
          connections.push(handlers);
          return {
            sendInput: () => {},
            takeOver: () => {},
            handBack: () => {},
            switchSurface: () => {},
            stop: () => {},
            close: () => {},
            stats: () => ({
              fps: undefined,
              kbps: 0,
              rttMs: undefined,
              decodeMs: undefined,
            }),
          };
        },
      }),
    };

    const { unmount } = render(() => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      const input = createScreenInput({
        frame: () => session.store.frame,
        container: () => ({ width: 960, height: 540 }),
        rotation: () => 0,
        sendsInput: session.drivingMe,
        send: (event) => session.sendInput(event),
        onHandBackHold: () => session.handBack(null),
      });
      return (
        <AgentScreen
          model={{
            harnessId: 'harness-1',
            agentName: () => 'Scout',
            canDrive: () => true,
            session,
            input,
            setContainerSize: () => {},
            driverName: () => 'Alice',
            turnOn: () => undefined,
          }}
        />
      );
    });
    await vi.advanceTimersByTimeAsync(0);
    connections[0].onFrameSize({ width: 1920, height: 1080 });
    connections[0].onState(state(true));

    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    keyboard.focus();
    // Everything that happens from here: any blur, any Take over shown.
    const blurs: string[] = [];
    keyboard.addEventListener('blur', () => blurs.push('blur'));
    const takeOverShown: string[] = [];
    const observer = new MutationObserver(() => {
      if (screen.queryByRole('button', { name: /^Take over/ }))
        takeOverShown.push('Take over');
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const typeSlash = () =>
      keyboard.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          bubbles: true,
          cancelable: true,
        })
      );

    // The guest tunnel dies: an error, then the end.
    connections[0].onError({ code: 'tunnelFailed', message: 'tunnel closed' });
    connections[0].onEnded('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(keyboard);
    typeSlash();

    // Reconnecting, then live, then the server says the lease is ours here.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(connections).toHaveLength(2);
    typeSlash();
    connections[1].onState(state(false));
    typeSlash();
    connections[1].onState(state(true));
    await vi.advanceTimersByTimeAsync(0);
    observer.disconnect();

    expect(blurs).toEqual([]);
    expect(document.activeElement).toBe(keyboard);
    expect(openSearch).not.toHaveBeenCalled();
    expect(takeOverShown).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'Hand back' }).hasAttribute('disabled')
    ).toBe(false);
    unmount();
  });
});
