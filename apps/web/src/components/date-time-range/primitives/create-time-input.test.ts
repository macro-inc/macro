import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  dayTimeOptions,
  endTimeOptions,
  selectedTimeOptionId,
  type TimeOption,
} from '../time-options';
import { createTimeInput } from './create-time-input';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup(options: TimeOption[] = dayTimeOptions('12-hour')) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [value, setValue] = createSignal('09:00');
    const [disabled, setDisabled] = createSignal(false);
    const changed = vi.fn((option: TimeOption) => setValue(option.value));
    const input = createTimeInput({
      options: () => options,
      selectedId: () => selectedTimeOptionId(value()),
      disabled,
      onChange: changed,
    });
    return { input, changed, value, setValue, setDisabled };
  });
}

it('opens a keyboard-free list before entering typed mode', () => {
  const { input, changed } = setup();
  input.openList();
  expect(input.state.mode).toBe('list');
  expect(input.highlighted()?.value).toBe('09:00');
  input.beginTyping();
  expect(input.state.mode).toBe('typing');
  expect(changed).not.toHaveBeenCalled();
});

it('completes typed text and commits the parsed clock value once', () => {
  const { input, changed, value } = setup();
  input.beginTyping();
  expect(input.input('4', true)).toBe('4:00am');
  input.input('4p', true);
  input.commit();
  input.commit();
  expect(value()).toBe('16:00');
  expect(changed).toHaveBeenCalledOnce();
  expect(input.state.mode).toBe('closed');
});

it('keeps an exact typed time outside the quarter-hour list', () => {
  const { input, changed } = setup();
  input.beginTyping();
  input.input('1307', true);
  input.commit();
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '13:07' })
  );
});

it('cancels typed changes and leaves passive list browsing unchanged', () => {
  const { input, changed, value } = setup();
  input.beginTyping();
  input.input('5p', true);
  input.reset();
  input.openList();
  input.commit();
  expect(value()).toBe('09:00');
  expect(changed).not.toHaveBeenCalled();
});

it('selects arrowed options but ignores invalid text', () => {
  const { input, changed } = setup();
  input.openList();
  input.moveHighlight(1);
  input.moveHighlight(1);
  input.commit();
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '09:30' })
  );
  input.beginTyping();
  input.input('soon', false);
  input.commit();
  expect(changed).toHaveBeenCalledOnce();
});

it('preserves end-list rollover and duration when typing', () => {
  const { input, changed, setValue } = setup(
    endTimeOptions('20:00', '12-hour')
  );
  setValue('21:00');
  input.beginTyping();
  input.input('7', true);
  input.commit();
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '07:00', dayOffset: 1, detail: '11h' })
  );
});

it('blocks a pending typed or picked value when editing becomes disabled', () => {
  const { input, changed, setDisabled } = setup();
  input.beginTyping();
  input.input('5p', true);
  setDisabled(true);
  expect(input.isOpen()).toBe(false);
  input.commit();
  input.choose(dayTimeOptions()[0]);
  input.openList();
  expect(input.state.mode).toBe('closed');
  expect(changed).not.toHaveBeenCalled();
});
