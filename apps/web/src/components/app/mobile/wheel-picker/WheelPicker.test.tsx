import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WHEEL_SETTLE_DELAY_MS } from './create-wheel-column';
import { WheelColumn, WheelPicker } from './WheelPicker';
import {
  WHEEL_ROW_HEIGHT,
  wheelCenterIndex,
  wheelRowStyle,
  wheelSnapIndex,
} from './wheel-values';

const OPTIONS = ['a', 'b', 'c'].map((value) => ({
  value,
  label: value.toUpperCase(),
}));

afterEach(() => vi.useRealTimers());

describe('wheel snapping', () => {
  it('maps fractional scroll positions to rows and bounds overscroll', () => {
    expect(wheelSnapIndex(65, 3, false)).toBe(1);
    expect(wheelSnapIndex(67, 3, false)).toBe(2);
    expect(wheelSnapIndex(-100, 3, false)).toBe(0);
    expect(wheelSnapIndex(1000, 3, false)).toBe(2);
    expect(wheelRowStyle(0)['font-size']).toBe('var(--text-lg)');
    expect(wheelRowStyle(1)['font-size']).toBe('var(--text-base)');
    expect(wheelRowStyle(2).opacity).toBe(0.6);
  });

  it('commits only on stop and recenters a looping value', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const view = render(() => {
      const [value, setValue] = createSignal('c');
      return (
        <WheelPicker>
          <WheelColumn
            label="Letter"
            options={OPTIONS}
            value={value()}
            width={64}
            loop
            onChange={(next) => {
              changed(next);
              setValue(next);
            }}
          />
        </WheelPicker>
      );
    });
    const wheel = view.getByRole('spinbutton', { name: 'Letter' });
    wheel.scrollTop = (wheelCenterIndex(2, 3, true) + 1) * WHEEL_ROW_HEIGHT + 2;
    fireEvent.scroll(wheel);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WHEEL_SETTLE_DELAY_MS);
    expect(changed).toHaveBeenCalledExactlyOnceWith('a');
    expect(wheel.scrollTop).toBe(
      wheelCenterIndex(0, 3, true) * WHEEL_ROW_HEIGHT
    );
    expect(wheel.getAttribute('aria-valuetext')).toBe('A');
  });

  it('ignores empty rows beyond a bounded column', () => {
    const changed = vi.fn();
    const view = render(() => (
      <WheelPicker>
        <WheelColumn
          label="Letter"
          options={OPTIONS}
          value="b"
          width={64}
          onChange={changed}
        />
      </WheelPicker>
    ));
    const wheel = view.getByRole('spinbutton');
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 64, 220)
    );
    fireEvent.click(wheel, { clientY: 0 });
    fireEvent.click(wheel, { clientY: 219 });
    expect(changed).not.toHaveBeenCalled();
  });

  it('selects a visible row by its viewport position', () => {
    const changed = vi.fn();
    const view = render(() => (
      <WheelPicker>
        <WheelColumn
          label="Letter"
          options={OPTIONS}
          value="a"
          width={64}
          onChange={changed}
        />
      </WheelPicker>
    ));
    const wheel = view.getByRole('spinbutton');
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 64, 220)
    );
    fireEvent.click(wheel, { clientY: 154 });
    expect(changed).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('supports bounded keyboard navigation and announces the selected value', () => {
    const view = render(() => {
      const [value, setValue] = createSignal('a');
      return (
        <WheelPicker>
          <WheelColumn
            label="Letter"
            options={OPTIONS}
            value={value()}
            width={64}
            onChange={setValue}
          />
        </WheelPicker>
      );
    });
    const wheel = view.getByRole('spinbutton');
    fireEvent.keyDown(wheel, { key: 'ArrowDown' });
    expect(wheel.getAttribute('aria-valuetext')).toBe('A');
    fireEvent.keyDown(wheel, { key: 'ArrowUp' });
    expect(wheel.getAttribute('aria-valuetext')).toBe('B');
    fireEvent.keyDown(wheel, { key: 'End' });
    expect(wheel.getAttribute('aria-valuetext')).toBe('C');
    fireEvent.keyDown(wheel, { key: 'Home' });
    expect(wheel.getAttribute('aria-valuetext')).toBe('A');
  });

  it('cancels pending changes when locked, replaced, or unmounted', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const [disabled, setDisabled] = createSignal(false);
    const [value, setValue] = createSignal('a');
    const view = render(() => (
      <WheelPicker>
        <WheelColumn
          label="Letter"
          options={OPTIONS}
          value={value()}
          width={64}
          disabled={disabled()}
          onChange={changed}
        />
      </WheelPicker>
    ));
    const wheel = view.getByRole('spinbutton');
    wheel.scrollTop = 80;
    fireEvent.scroll(wheel);
    setDisabled(true);
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
    setDisabled(false);
    wheel.scrollTop = 80;
    fireEvent.scroll(wheel);
    setValue('b');
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
    wheel.scrollTop = 80;
    fireEvent.scroll(wheel);
    view.unmount();
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
  });

  it('waits for touchend after native scrolling cancels the pointer', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const view = render(() => (
      <WheelPicker>
        <WheelColumn
          label="Letter"
          options={OPTIONS}
          value="a"
          width={64}
          onChange={changed}
        />
      </WheelPicker>
    ));
    const wheel = view.getByRole('spinbutton');
    fireEvent.pointerDown(wheel);
    fireEvent.touchStart(wheel);
    fireEvent.pointerCancel(wheel);
    wheel.scrollTop = 44;
    fireEvent.scroll(wheel);
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.touchEnd(window);
    vi.advanceTimersByTime(200);
    expect(changed).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('keeps independently scrolling columns independent', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const view = render(() => (
      <WheelPicker>
        <For each={['First', 'Second']}>
          {(label) => (
            <WheelColumn
              label={label}
              options={OPTIONS}
              value="a"
              width={64}
              onChange={(value) => changed(label, value)}
            />
          )}
        </For>
      </WheelPicker>
    ));
    const first = view.getByRole('spinbutton', { name: 'First' });
    fireEvent.pointerDown(first);
    first.scrollTop = 80;
    fireEvent.scroll(first);
    vi.advanceTimersByTime(200);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    vi.advanceTimersByTime(200);
    expect(changed).toHaveBeenCalledExactlyOnceWith('First', 'c');
  });
  it.each([
    [61, 'b'],
    [-61, 'c'],
    [301, 'b'],
    [-301, 'c'],
  ] as const)(
    'keeps native scrolling untouched for displacement %s before settling',
    (displacement, expected) => {
      vi.useFakeTimers();
      const changed = vi.fn();
      const view = render(() => (
        <WheelPicker>
          <WheelColumn
            label="Letter"
            options={OPTIONS}
            value="a"
            width={64}
            loop
            onChange={changed}
          />
        </WheelPicker>
      ));
      const wheel = view.getByRole('spinbutton');
      const anchor = wheel.querySelector('.wheel-picker-snap');
      expect(anchor).not.toBeNull();
      const position = wheel.scrollTop + displacement * WHEEL_ROW_HEIGHT;
      fireEvent.touchStart(wheel);
      wheel.scrollTop = position;
      fireEvent.scroll(wheel);
      vi.advanceTimersByTime(200);
      expect(wheel.scrollTop).toBe(position);
      expect(wheel.querySelector('.wheel-picker-snap')).toBe(anchor);
      expect(
        wheel.querySelectorAll('.wheel-picker-row').length
      ).toBeLessThanOrEqual(8);
      expect(changed).not.toHaveBeenCalled();
      fireEvent.touchEnd(window);
      vi.advanceTimersByTime(200);
      expect(changed).toHaveBeenCalledExactlyOnceWith(expected);
      expect(wheel.scrollTop).not.toBe(position);
    }
  );
});
