import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { KeyBar } from './key-bar';

describe('KeyBar', () => {
  it('keeps the phone keyboard up: presses on the key row, gaps included, never take focus', () => {
    render(() => <KeyBar agentName="Ada" onText={() => {}} onKey={() => {}} />);
    const control = screen.getByRole('button', { name: 'Ctrl' });
    const row = control.parentElement;
    if (!row) throw new Error('no key row');

    // WKWebView synthesises a mousedown even after a cancelled pointerdown.
    for (const target of [control, row]) {
      expect(fireEvent.pointerDown(target)).toBe(false);
      expect(fireEvent.mouseDown(target)).toBe(false);
    }
    // The text field itself still takes focus.
    expect(fireEvent.mouseDown(screen.getByRole('textbox'))).toBe(true);
  });

  it('gives focus back to the text field after a key is pressed, by tap or by keyboard', () => {
    const keys: [number, boolean][] = [];
    render(() => (
      <KeyBar
        agentName="Ada"
        onText={() => {}}
        onKey={(keysym, down) => keys.push([keysym, down])}
      />
    ));
    const field = screen.getByRole('textbox');

    // A tablet's hardware keyboard activates a focused key with Enter or
    // Space, which arrives as a click; a tap that focused it clicks too.
    for (const name of ['Ctrl', 'Esc']) {
      const key = screen.getByRole('button', { name });
      key.focus();
      fireEvent.click(key);
      expect(document.activeElement).toBe(field);
    }
    expect(keys).toEqual([
      [0xffe3, true],
      [0xff1b, true],
      [0xff1b, false],
      [0xffe3, false],
    ]);
  });
});
