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
});
