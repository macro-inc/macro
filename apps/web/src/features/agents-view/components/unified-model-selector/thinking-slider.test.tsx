import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectSessionConfigOption } from '../../../block-agent/state/session-config';
import { thinkingChoice, thinkingLevel } from '../../core/thinking-level';
import { ThinkingSlider } from './thinking-slider';

afterEach(cleanup);

const EFFORT: SelectSessionConfigOption = {
  id: 'opaque-effort',
  name: 'Thinking',
  description: null,
  category: 'thought_level',
  type: 'select',
  currentValue: 'b',
  options: [
    { value: 'a', name: 'Low', description: null, group: null },
    { value: 'b', name: 'Medium', description: null, group: null },
    { value: 'c', name: 'High', description: null, group: null },
  ],
};

describe('Thinking slider', () => {
  it('maps ordered levels without interpreting opaque option values', () => {
    expect(thinkingLevel(EFFORT)).toBe(1);
    expect(thinkingLevel(EFFORT, 'c')).toBe(2);
    expect(thinkingChoice(EFFORT, 1.6)).toEqual({
      configId: 'opaque-effort',
      value: 'c',
      name: 'High',
    });
    expect(thinkingChoice(EFFORT, -10)?.value).toBe('a');
    expect(thinkingChoice(EFFORT, 100)?.value).toBe('c');
    expect(thinkingChoice(undefined, 0)).toBeUndefined();
  });
  it('commits each arrow, Home, and End key immediately with accessible value text', () => {
    const commit = vi.fn();
    const [value, setValue] = createSignal('b');
    render(() => (
      <ThinkingSlider
        effort={EFFORT}
        value={value()}
        onCommit={(choice) => {
          commit(choice);
          setValue(choice.value);
        }}
      />
    ));
    const slider = screen.getByRole('slider', { name: 'Thinking' });
    slider.focus();
    for (const [key, value] of [
      ['ArrowRight', 'c'],
      ['ArrowLeft', 'b'],
      ['Home', 'a'],
      ['End', 'c'],
      ['ArrowDown', 'b'],
      ['ArrowUp', 'c'],
    ]) {
      fireEvent.keyDown(slider, { key });
      expect(commit).toHaveBeenLastCalledWith(
        expect.objectContaining({ value })
      );
    }
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
  });
  it('previews pointer changes, commits on release, and discards cancellation', () => {
    const commit = vi.fn();
    render(() => <ThinkingSlider effort={EFFORT} onCommit={commit} />);
    const thumb = screen.getByRole('slider', { name: 'Thinking' });
    const track = thumb.parentElement!;
    let captured = false;
    Object.assign(track, {
      setPointerCapture: () => {
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
      },
      getBoundingClientRect: () => new DOMRect(0, 0, 278, 24),
    });
    const pointer = (type: string) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: 278,
        clientY: 12,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(track, event);
    };
    pointer('pointerdown');
    expect(commit).not.toHaveBeenCalled();
    expect(thumb.getAttribute('aria-valuetext')).toBe('High');
    pointer('pointerup');
    expect(commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: 'c' })
    );
    commit.mockClear();
    pointer('pointerdown');
    pointer('pointercancel');
    pointer('pointerup');
    expect(commit).not.toHaveBeenCalled();
  });
  it.each([{ options: [] }, { options: [EFFORT.options[0]] }])(
    'reserves the no-thinking slot for nonadjustable options',
    ({ options }) => {
      render(() => (
        <ThinkingSlider effort={{ ...EFFORT, options }} onCommit={vi.fn()} />
      ));
      expect(screen.queryByRole('slider')).toBeNull();
      expect(screen.getByText('Not available for this model')).toBeTruthy();
    }
  );
  it('does not commit keyboard input when disabled', () => {
    const commit = vi.fn();
    render(() => <ThinkingSlider effort={EFFORT} disabled onCommit={commit} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Thinking' }), {
      key: 'End',
    });
    expect(commit).not.toHaveBeenCalled();
  });
});
