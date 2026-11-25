import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenStage, type ScreenStageHandlers } from './screen-stage';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setActiveScope('global');
  setPressedKeys(new Set<string>());
});

function handlers(
  onKeyDown: (event: KeyboardEvent) => void
): ScreenStageHandlers {
  return {
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerCancel: () => {},
    onWheel: () => {},
    onContextMenu: () => {},
    onKeyDown,
    onKeyUp: () => {},
    onCompositionEnd: () => {},
    onBlur: () => {},
    onPaste: () => {},
  };
}

describe('ScreenStage keyboard', () => {
  it("owns every key while driving: the app's hotkeys don't run, the guest gets them", () => {
    // The app's real hotkey root, with Create on "c" as in the app, made to
    // run even in text fields as the app's input-proof hotkeys do.
    const openCreate = vi.fn(() => true);
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot();
      registerHotkey({
        scopeId: 'global',
        hotkey: 'c',
        description: 'Create',
        runWithInputFocused: true,
        keyDownHandler: openCreate,
      });
    });
    const typed: string[] = [];

    const { unmount } = render(() => (
      <ScreenStage
        label="Scout's desktop"
        keyboardLabel="Keyboard for Scout's desktop"
        frame={{ width: 1920, height: 1080 }}
        transform={undefined}
        pictureBox={undefined}
        driven
        drivingMe
        ownsKeyboard
        takeOvers={0}
        focusOnTakeOver={false}
        stale={false}
        loupe={undefined}
        snapshot={() => undefined}
        handlers={handlers((event) => typed.push(event.key))}
        containerRef={() => {}}
        frameRef={() => {}}
      />
    ));
    const keyboard = screen.getByRole('textbox', {
      name: "Keyboard for Scout's desktop",
    });
    keyboard.focus();
    for (const key of ['m', 'a', 'c', 'r', 'o']) {
      keyboard.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
      keyboard.dispatchEvent(
        new KeyboardEvent('keyup', { key, bubbles: true })
      );
    }

    expect(typed).toEqual(['m', 'a', 'c', 'r', 'o']);
    expect(openCreate).not.toHaveBeenCalled();
    unmount();

    // Outside the viewer the same key still opens Create.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(openCreate).toHaveBeenCalledTimes(1);
  });

  it('lets a key pressed outside and released inside the viewer go, so no app hotkey sticks', () => {
    const openCreate = vi.fn(() => true);
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot();
      registerHotkey({
        scopeId: 'global',
        hotkey: 'c',
        description: 'Create',
        keyDownHandler: openCreate,
      });
    });
    const { unmount } = render(() => (
      <ScreenStage
        label="Scout's desktop"
        keyboardLabel="Keyboard for Scout's desktop"
        frame={{ width: 1920, height: 1080 }}
        transform={undefined}
        pictureBox={undefined}
        driven
        drivingMe
        ownsKeyboard
        takeOvers={0}
        focusOnTakeOver={false}
        stale={false}
        loupe={undefined}
        snapshot={() => undefined}
        handlers={handlers(() => {})}
        containerRef={() => {}}
        frameRef={() => {}}
      />
    ));
    const keyboard = screen.getByRole('textbox', {
      name: "Keyboard for Scout's desktop",
    });

    // Shift+Tab from the Hand back button: Tab goes down outside the viewer…
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    );
    // …and comes up inside it.
    keyboard.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Tab', bubbles: true })
    );
    unmount();

    // Back in the app, "c" is "c", not "tab+c".
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(openCreate).toHaveBeenCalledTimes(1);
  });

  it('runs no hotkey on a key-up inside the viewer, though it still releases the key', () => {
    const seen: string[] = [];
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot()?.addHotkeyInterceptor((context) => {
        seen.push(`${context.eventType}:${context.pressedKeysString}`);
        return false;
      });
    });
    const { unmount } = render(() => (
      <ScreenStage
        label="Scout's desktop"
        keyboardLabel="Keyboard for Scout's desktop"
        frame={{ width: 1920, height: 1080 }}
        transform={undefined}
        pictureBox={undefined}
        driven
        drivingMe
        ownsKeyboard
        takeOvers={0}
        focusOnTakeOver={false}
        stale={false}
        loupe={undefined}
        snapshot={() => undefined}
        handlers={handlers(() => {})}
        containerRef={() => {}}
        frameRef={() => {}}
      />
    ));
    const keyboard = screen.getByRole('textbox', {
      name: "Keyboard for Scout's desktop",
    });
    // Two keys held outside; one is let go over the viewer's field.
    for (const key of ['x', 'y']) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
    }
    seen.length = 0;
    keyboard.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'x', bubbles: true })
    );

    expect(seen).toEqual([]);
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'y', bubbles: true })
    );
    // "x" was released by the viewer's key-up: only "y" was still down.
    expect(seen).toEqual([]);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(seen).toEqual(['keydown:z']);
    unmount();
  });

  it("keeps the keyboard while a dropped drive reconnects: keys never reach the app's hotkeys", () => {
    const openCreate = vi.fn(() => true);
    createRoot((dispose) => {
      disposers.push(dispose);
      useHotKeyRoot();
      registerHotkey({
        scopeId: 'global',
        hotkey: 'c',
        description: 'Create',
        runWithInputFocused: true,
        keyDownHandler: openCreate,
      });
    });
    const typed: string[] = [];
    const [driving, setDriving] = createSignal(true);
    const [owns, setOwns] = createSignal(true);
    const { unmount } = render(() => (
      <ScreenStage
        label="Scout's desktop"
        keyboardLabel="Keyboard for Scout's desktop"
        frame={{ width: 1920, height: 1080 }}
        transform={undefined}
        pictureBox={undefined}
        driven
        drivingMe={driving()}
        ownsKeyboard={owns()}
        takeOvers={0}
        focusOnTakeOver={false}
        stale={false}
        loupe={undefined}
        snapshot={() => undefined}
        handlers={handlers((event) => typed.push(event.key))}
        containerRef={() => {}}
        frameRef={() => {}}
      />
    ));
    const keyboard = screen.getByRole('textbox', {
      name: "Keyboard for Scout's desktop",
    });
    keyboard.focus();
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      keyboard.dispatchEvent(event);
      keyboard.dispatchEvent(
        new KeyboardEvent('keyup', { key, bubbles: true })
      );
      return event;
    };

    // The socket dropped: no longer driving, still reconnecting the drive.
    setDriving(false);
    const swallowed = press('c');
    expect(swallowed.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(keyboard);
    expect(openCreate).not.toHaveBeenCalled();
    // The input handler still sees it, for the release chord; it sends
    // nothing while not driving (views/agent-screen.test.tsx).
    expect(typed).toEqual(['c']);

    // The lease went to someone else: the keyboard is the app's again.
    setOwns(false);
    expect(document.activeElement).not.toBe(keyboard);
    unmount();
  });
});
