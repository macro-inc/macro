import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
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
        frame={{ width: 1920, height: 1080 }}
        transform={undefined}
        driven
        drivingMe
        stale={false}
        loupe={undefined}
        snapshot={() => undefined}
        handlers={handlers((event) => typed.push(event.key))}
        containerRef={() => {}}
        frameRef={() => {}}
      />
    ));
    const keyboard = screen.getByRole('textbox', { name: "Scout's desktop" });
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
});
