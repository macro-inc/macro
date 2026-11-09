/** @vitest-environment jsdom */
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CALL_SPEAKER_HOLD_MS,
  createHeldCallPreview,
} from '../call-mini-player-selection';

afterEach(() => vi.useRealTimers());

it('holds a speaker through short gaps, but prioritizes shares and reduced motion', () => {
  vi.useFakeTimers();
  const first = {
    id: 'first',
    speaking: false,
    hasVideo: false,
    sharing: false,
  };
  const second = {
    id: 'second',
    speaking: true,
    hasVideo: false,
    sharing: false,
  };
  const [people, setPeople] = createSignal([first]);
  const [reduced, setReduced] = createSignal(false);
  let selected!: ReturnType<typeof createHeldCallPreview>;
  render(() => {
    selected = createHeldCallPreview(people, reduced);
    return null;
  });
  expect(selected()?.id).toBe('first');
  setPeople([first, second]);
  vi.advanceTimersByTime(CALL_SPEAKER_HOLD_MS - 1);
  expect(selected()?.id).toBe('first');
  vi.advanceTimersByTime(1);
  expect(selected()?.id).toBe('second');
  setPeople([first, { ...second, speaking: false }]);
  vi.advanceTimersByTime(200);
  setPeople([first, second]);
  vi.advanceTimersByTime(CALL_SPEAKER_HOLD_MS);
  expect(selected()?.id).toBe('second');
  setPeople([{ ...first, sharing: true }, second]);
  expect(selected()?.id).toBe('first');
  setPeople([first, second]);
  setReduced(true);
  expect(selected()?.id).toBe('second');
  setPeople([first]);
  expect(selected()?.id).toBe('first');
});
