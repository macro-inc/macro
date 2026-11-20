import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
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
});
