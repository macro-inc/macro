import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createRoot, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScreenCapabilities } from '../context/screen-context';
import { createScreenInput } from '../primitives/screen-input';
import { createScreenSession } from '../primitives/screen-session';
import type {
  ScreenInputEvent,
  ScreenSessionHandlers,
  ScreenState,
} from '../transports/types';
import { AgentScreen } from './agent-screen';
import { MobileAgentScreen } from './mobile/agent-screen';
import type { AgentScreenModel } from './shared/agent-screen-model';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: () => {} }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children?: JSX.Element }) => props.children,
  SplitHeaderRight: (props: { children?: JSX.Element }) => props.children,
}));
vi.mock('@components/app/mobile-header/mobile-header', () => {
  const passThrough = (props: { children?: JSX.Element }) => props.children;
  return {
    MobileHeader: Object.assign(passThrough, {
      Island: passThrough,
      Title: passThrough,
    }),
  };
});

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

type Connection = {
  handlers: ScreenSessionHandlers;
  sent: ScreenInputEvent[];
  open: () => void;
};

/**
 * A transport whose first connection opens at once and whose later ones wait
 * for `open()`, saying the state first: the order a reconnect sees, where the
 * harness reports the lease (still on the dropped socket) before the picture.
 */
function capabilities(connections: Connection[]): ScreenCapabilities {
  return {
    requestTicket: async () =>
      ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
    transport: () => ({
      kind: 'vnc',
      connect: async (_element, _ticket, handlers) => {
        const sent: ScreenInputEvent[] = [];
        let open = () => {};
        const opened = new Promise<void>((resolve) => {
          open = resolve;
        });
        connections.push({ handlers, sent, open });
        if (connections.length > 1) {
          handlers.onState(state(false));
          await opened;
        }
        return {
          sendInput: (event) => sent.push(event),
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
}

function renderView(
  View: (props: { model: AgentScreenModel }) => JSX.Element,
  connections: Connection[]
) {
  return render(() => {
    const session = createScreenSession({
      harnessId: 'harness-1',
      canDrive: () => true,
      accessKnown: () => true,
      currentUserId: () => 'user-alice',
      transport: () => 'vnc',
      capabilities: capabilities(connections),
    });
    const input = createScreenInput({
      frame: () => session.store.frame,
      container: () => ({ width: 960, height: 540 }),
      rotation: () => 0,
      sendsInput: session.drivingMe,
      send: (event) => session.sendInput(event),
      onHandBackHold: () => session.handBack(null),
      isMac: false,
    });
    return (
      <View
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
}

/** Records every blur of `field` and every moment the wrong controls show. */
function watch(field: HTMLElement) {
  const blurs: string[] = [];
  field.addEventListener('blur', () => blurs.push('blur'));
  const flashes: string[] = [];
  const observer = new MutationObserver(() => {
    if (screen.queryByRole('button', { name: /^Take over/ }))
      flashes.push('Take over');
    if (screen.queryByText('You’re driving in another tab'))
      flashes.push('another tab');
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return { blurs, flashes, stop: () => observer.disconnect() };
}

/** The guest tunnel dies, and the viewer reconnects and takes the lease back. */
async function dropAndResume(connections: Connection[], during: () => void) {
  connections[0].handlers.onError({
    code: 'tunnelFailed',
    message: 'tunnel closed',
  });
  connections[0].handlers.onEnded('error');
  during();
  // Reconnecting: the new socket first says the lease is on the old one.
  await vi.advanceTimersByTimeAsync(5_000);
  expect(connections).toHaveLength(2);
  during();
  connections[1].open();
  await vi.advanceTimersByTimeAsync(0);
  during();
  connections[1].handlers.onState(state(true));
  await vi.advanceTimersByTimeAsync(0);
}

function hotkeys() {
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
  return openSearch;
}

describe('the screen viewer while a drive drops', () => {
  it("desktop: keeps the keyboard and the driver's controls from the end, through reconnecting, and types into the guest again after", async () => {
    vi.useFakeTimers();
    const openSearch = hotkeys();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onFrameSize({ width: 1920, height: 1080 });
    connections[0].handlers.onState(state(true));

    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    keyboard.focus();
    const watching = watch(keyboard);
    const typeSlash = () =>
      keyboard.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          code: 'Slash',
          bubbles: true,
          cancelable: true,
        })
      );

    await dropAndResume(connections, () => {
      expect(document.activeElement).toBe(keyboard);
      typeSlash();
    });
    watching.stop();

    expect(watching.blurs).toEqual([]);
    expect(watching.flashes).toEqual([]);
    expect(openSearch).not.toHaveBeenCalled();
    // Nothing typed while it was away reached the guest; now it does.
    expect(connections[1].sent).toEqual([]);
    expect(document.activeElement).toBe(keyboard);
    typeSlash();
    expect(connections[1].sent).toEqual([
      { kind: 'key', keysym: 0x2f, down: true },
    ]);
    expect(openSearch).not.toHaveBeenCalled();
    unmount();
  });

  it('desktop: takes the keyboard back after the resume when focus was lost meanwhile', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState(state(true));
    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    keyboard.focus();

    let blurred = false;
    await dropAndResume(connections, () => {
      // Something (the browser, a removed node) dropped focus to the page.
      if (!blurred) keyboard.blur();
      blurred = true;
    });

    expect(document.activeElement).toBe(keyboard);
    unmount();
  });

  it('phone: keeps the key bar and its keyboard, without Take over or "another tab", and types into the guest again after', async () => {
    vi.useFakeTimers();
    const openSearch = hotkeys();
    const connections: Connection[] = [];
    const { unmount } = renderView(MobileAgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onFrameSize({ width: 1920, height: 1080 });
    connections[0].handlers.onState(state(true));

    fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    const keyBar = screen.getByRole('textbox', {
      name: 'Type to send to Scout',
    });
    keyBar.focus();
    const watching = watch(keyBar);

    await dropAndResume(connections, () => {
      expect(document.activeElement).toBe(keyBar);
    });
    watching.stop();

    expect(watching.blurs).toEqual([]);
    expect(watching.flashes).toEqual([]);
    expect(openSearch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }));
    expect(connections[1].sent).toEqual([
      { kind: 'key', keysym: 0xff1b, down: true },
      { kind: 'key', keysym: 0xff1b, down: false },
    ]);
    unmount();
  });

  it('desktop: Ctrl+Alt+Shift still leaves the keyboard while a drive is being resumed, and the resume leaves it alone', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState(state(true));
    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    keyboard.focus();

    let left = false;
    await dropAndResume(connections, () => {
      if (left) return;
      left = true;
      // No keyboard trap: the release chord works while reconnecting.
      for (const key of ['Control', 'Alt', 'Shift']) {
        keyboard.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            ctrlKey: true,
            altKey: key !== 'Control',
            shiftKey: key === 'Shift',
            bubbles: true,
            cancelable: true,
          })
        );
      }
      expect(document.activeElement).not.toBe(keyboard);
    });

    // Left on purpose: the resume doesn't pull focus back.
    expect(document.activeElement).not.toBe(keyboard);
    unmount();
  });
});
