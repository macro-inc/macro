import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ScreenInputEvent } from '../transports/types';
import { createScreenInput } from './screen-input';

describe('createScreenInput keyboard', () => {
  it('types an IME composition once at commit, and passes plain keys and dead keys correctly', () => {
    const sent: ScreenInputEvent[] = [];
    createRoot((dispose) => {
      const input = createScreenInput({
        frame: () => ({ width: 1920, height: 1080 }),
        container: () => ({ width: 960, height: 540 }),
        rotation: () => 0,
        sendsInput: () => true,
        send: (event) => sent.push(event),
        onHandBackHold: () => {},
      });
      const field = document.createElement('textarea');
      const keyDown = (init: KeyboardEventInit & { keyCode?: number }) => {
        const event = new KeyboardEvent('keydown', {
          cancelable: true,
          ...init,
        });
        if (init.keyCode !== undefined)
          Object.defineProperty(event, 'keyCode', { value: init.keyCode });
        input.onKeyDown(event);
        return event;
      };

      // A plain key goes to the guest as a keysym, and stays out of the field.
      const plain = keyDown({ key: 'a', code: 'KeyA' });
      expect(plain.defaultPrevented).toBe(true);
      input.onKeyUp(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }));

      // While a Japanese IME composes, its keys stay in the field…
      const composing = keyDown({ key: 'n', code: 'KeyN', isComposing: true });
      expect(composing.defaultPrevented).toBe(false);
      keyDown({ key: 'Process', code: 'KeyI', keyCode: 229 });
      // …and Enter that picks the candidate is no Return for the guest.
      keyDown({ key: 'Enter', code: 'Enter', isComposing: true });
      field.value = '日本';
      const committed = new CompositionEvent('compositionend', {
        data: '日本',
      });
      Object.defineProperty(committed, 'currentTarget', { value: field });
      input.onCompositionEnd(committed);
      expect(field.value).toBe('');

      // A dead key composes too (´ then e gives é).
      expect(keyDown({ key: 'Dead', code: 'Quote' }).defaultPrevented).toBe(
        false
      );

      expect(sent).toEqual([
        { kind: 'key', keysym: 0x61, down: true },
        { kind: 'key', keysym: 0x61, down: false },
        { kind: 'text', text: '日本' },
      ]);
      dispose();
    });
  });

  it("lets go of held keys before a hand-back, maps a Mac's Cmd to Ctrl, and pastes the guest's clipboard when nothing local arrives", async () => {
    vi.useFakeTimers();
    const sent: ScreenInputEvent[] = [];
    await createRoot(async (dispose) => {
      const input = createScreenInput({
        frame: () => ({ width: 1920, height: 1080 }),
        container: () => ({ width: 960, height: 540 }),
        rotation: () => 0,
        sendsInput: () => true,
        send: (event) => sent.push(event),
        onHandBackHold: () => {},
        isMac: true,
      });
      const field = document.createElement('textarea');
      const keyDown = (init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', {
          cancelable: true,
          ...init,
        });
        Object.defineProperty(event, 'currentTarget', { value: field });
        input.onKeyDown(event);
      };

      // Cmd+C on a Mac is Ctrl+C in the Linux guest.
      keyDown({ key: 'Meta', code: 'MetaLeft', metaKey: true });
      keyDown({ key: 'c', code: 'KeyC', metaKey: true });
      // Cmd+V with an empty local clipboard: no paste event arrives, so the
      // guest pastes its own clipboard (Cmd is already down as Ctrl).
      keyDown({ key: 'v', code: 'KeyV', metaKey: true });
      await vi.advanceTimersByTimeAsync(100);
      expect(sent).toEqual([
        { kind: 'key', keysym: 0xffe3, down: true },
        { kind: 'key', keysym: 0x63, down: true },
        { kind: 'key', keysym: 0x76, down: true },
        { kind: 'key', keysym: 0x76, down: false },
      ]);

      sent.length = 0;
      keyDown({ key: 'a', code: 'KeyA', metaKey: true });
      // Holding Esc (or the Hand back button) lets go of all of it first.
      input.releaseAll();
      expect(sent).toEqual([
        { kind: 'key', keysym: 0x61, down: true },
        { kind: 'key', keysym: 0xffe3, down: false },
        { kind: 'key', keysym: 0x63, down: false },
        { kind: 'key', keysym: 0x61, down: false },
      ]);
      dispose();
    });
    vi.useRealTimers();
  });

  it('Ctrl+Alt+Shift leaves the keyboard without handing back', () => {
    const sent: ScreenInputEvent[] = [];
    let handedBack = false;
    createRoot((dispose) => {
      const input = createScreenInput({
        frame: () => ({ width: 1920, height: 1080 }),
        container: () => ({ width: 960, height: 540 }),
        rotation: () => 0,
        sendsInput: () => true,
        send: (event) => sent.push(event),
        onHandBackHold: () => {
          handedBack = true;
        },
        isMac: false,
      });
      const field = document.createElement('textarea');
      document.body.append(field);
      field.focus();
      const keyDown = (init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', {
          cancelable: true,
          ...init,
        });
        Object.defineProperty(event, 'currentTarget', { value: field });
        input.onKeyDown(event);
      };
      keyDown({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
      keyDown({ key: 'Alt', code: 'AltLeft', ctrlKey: true, altKey: true });
      keyDown({
        key: 'Shift',
        code: 'ShiftLeft',
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });

      expect(document.activeElement).not.toBe(field);
      expect(handedBack).toBe(false);
      // The two modifiers the guest saw go down come back up.
      expect(sent.slice(2)).toEqual([
        { kind: 'key', keysym: 0xffe3, down: false },
        { kind: 'key', keysym: 0xffe9, down: false },
      ]);
      field.remove();
      dispose();
    });
  });
});
