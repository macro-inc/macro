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

const ALICE = { name: 'Alice', isYou: true };

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
          retry: () => session.retry(),
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

describe('a refused Take over', () => {
  it('says the access check failed, and leaves Take over to try again', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState({ ...state(true), driver: null });

    fireEvent.click(screen.getByRole('button', { name: /^Take over/ }));
    connections[0].handlers.onError({
      code: 'takeOverUnavailable',
      message: 'access check failed',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByText('Couldn’t check that you may take over; try again.')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /^Take over/ })
        .hasAttribute('disabled')
    ).toBe(false);
    unmount();
  });

  it('stops taking over and says it did not work when the answer is a code this client does not know', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState({ ...state(true), driver: null });

    fireEvent.click(screen.getByRole('button', { name: /^Take over/ }));
    expect(screen.getByRole('button', { name: /Taking over/ })).toBeTruthy();
    connections[0].handlers.onError({ code: 'unknown', message: 'new' });
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole('button', { name: /Taking over/ })).toBeNull();
    expect(screen.getByText('That didn’t work. Try again.')).toBeTruthy();
    unmount();
  });

  it('says the agent could not be paused, and leaves Take over to try again', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState({ ...state(true), driver: null });

    fireEvent.click(screen.getByRole('button', { name: /^Take over/ }));
    connections[0].handlers.onError({
      code: 'agentNotPausable',
      message: 'could not freeze the agent',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByText(
        'Couldn’t pause the agent on this computer, so it can’t be taken over right now.'
      )
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /^Take over/ })
        .hasAttribute('disabled')
    ).toBe(false);
    unmount();
  });
});

describe('what the viewer says the agent does while someone drives', () => {
  it.each([
    ['desktop', AgentScreen],
    ['phone', MobileAgentScreen],
  ])(
    '%s: paused only when the server holds the agent',
    async (_device, View) => {
      vi.useFakeTimers();
      const connections: Connection[] = [];
      const { unmount } = renderView(View, connections);
      await vi.advanceTimersByTimeAsync(0);

      connections[0].handlers.onState({ ...state(true), agentHeld: false });
      expect(screen.queryByText(/is paused/)).toBeNull();
      expect(
        screen.getByText(/Scout isn’t paused and keeps working/)
      ).toBeTruthy();

      connections[0].handlers.onState({ ...state(true), agentHeld: true });
      expect(screen.getByText(/Scout is paused · tools held/)).toBeTruthy();
      unmount();
    }
  );
});

describe('a drive that lapses', () => {
  it('says so, and keeps the keys from the app until the person acts', async () => {
    vi.useFakeTimers();
    const openSearch = hotkeys();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState(state(true));
    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    keyboard.focus();

    connections[0].handlers.onState({ ...state(false), driver: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByText(
        'You’re no longer driving: the drive ended after a while without input.'
      )
    ).toBeTruthy();
    expect(document.activeElement).toBe(keyboard);
    keyboard.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(openSearch).not.toHaveBeenCalled();
    expect(connections[0].sent).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.activeElement).not.toBe(keyboard);
    unmount();
  });
});

describe('the first Take over', () => {
  it('desktop: gives the keyboard to the drive, since the button that had focus goes away', async () => {
    vi.useFakeTimers();
    const openSearch = hotkeys();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState({ ...state(true), driver: null });

    const takeOver = screen.getByRole('button', { name: /^Take over/ });
    takeOver.focus();
    fireEvent.click(takeOver);
    connections[0].handlers.onState(state(true));
    await vi.advanceTimersByTimeAsync(0);

    const keyboard = screen.getByRole('textbox', {
      name: 'Keyboard for Scout’s desktop',
    });
    expect(document.activeElement).toBe(keyboard);
    keyboard.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '/',
        code: 'Slash',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(openSearch).not.toHaveBeenCalled();
    unmount();
  });
});

describe('a revoked drive', () => {
  it('offers View screen again', async () => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(AgentScreen, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState(state(true));

    connections[0].handlers.onEnded('accessRevoked');
    await vi.advanceTimersByTimeAsync(0);
    expect(
      screen.getByText('You no longer have access to this screen')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View screen again' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toHaveLength(2);
    unmount();
  });
});

describe('Stop watching', () => {
  it.each([
    ['desktop', AgentScreen],
    ['phone', MobileAgentScreen],
  ])('%s: is there while driving too', async (_device, View) => {
    vi.useFakeTimers();
    const connections: Connection[] = [];
    const { unmount } = renderView(View, connections);
    await vi.advanceTimersByTimeAsync(0);
    connections[0].handlers.onState(state(true));
    expect(screen.getByRole('button', { name: 'Stop watching' })).toBeTruthy();
    unmount();
  });
});

describe('pasting while others watch', () => {
  it.each([
    ['desktop', AgentScreen],
    ['phone', MobileAgentScreen],
  ])(
    '%s: warns the driver that watchers can see a paste, only while someone else watches',
    async (_device, View) => {
      vi.useFakeTimers();
      const connections: Connection[] = [];
      const { unmount } = renderView(View, connections);
      await vi.advanceTimersByTimeAsync(0);

      connections[0].handlers.onState(state(true));
      expect(screen.queryByText('Watchers can see what you paste')).toBeNull();
      connections[0].handlers.onState({ ...state(true), viewers: 2 });
      expect(screen.getByText('Watchers can see what you paste')).toBeTruthy();
      unmount();
    }
  );
});

describe('a drive the agent takes back', () => {
  it.each([
    ['desktop', AgentScreen],
    ['phone', MobileAgentScreen],
  ])(
    '%s: says the agent could not stay paused, keeps the keys, and offers Take over again',
    async (_device, View) => {
      vi.useFakeTimers();
      const connections: Connection[] = [];
      const { unmount } = renderView(View, connections);
      await vi.advanceTimersByTimeAsync(0);
      connections[0].handlers.onState(state(true));

      // The lease change first, then the harness's reason.
      connections[0].handlers.onState({ ...state(false), driver: null });
      connections[0].handlers.onError({
        code: 'agentNotPausable',
        message:
          'The agent couldn’t be kept paused, so it has the computer back.',
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(
        screen.getByText(
          'You’re no longer driving: Scout couldn’t stay paused, so it has the computer back.'
        )
      ).toBeTruthy();
      expect(screen.queryByText(/after a while without input/)).toBeNull();
      expect(screen.queryByText(/can’t be taken over right now/)).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Take over again' })
      ).toBeTruthy();
      unmount();
    }
  );
});
