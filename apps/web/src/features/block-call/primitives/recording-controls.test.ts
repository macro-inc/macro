// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createRecordingControlsVisibility } from './recording-controls';

afterEach(() => vi.useRealTimers());

it('dismisses idle playback, wakes on interaction, and stays visible when paused', () => {
  vi.useFakeTimers();
  let dispose!: () => void;
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    const [paused, setPaused] = createSignal(true);
    return { controls: createRecordingControlsVisibility(paused), setPaused };
  });
  vi.advanceTimersByTime(3000);
  expect(state.controls.visible()).toBe(true);
  state.setPaused(false);
  vi.advanceTimersByTime(2500);
  expect(state.controls.visible()).toBe(false);
  state.controls.show();
  expect(state.controls.visible()).toBe(true);
  vi.advanceTimersByTime(2400);
  state.controls.show();
  vi.advanceTimersByTime(2400);
  expect(state.controls.visible()).toBe(true);
  vi.advanceTimersByTime(100);
  expect(state.controls.visible()).toBe(false);
  state.setPaused(true);
  expect(state.controls.visible()).toBe(true);
  dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['setHovered', 'setFocused', 'setMenuOpen'] as const)(
  'holds controls during %s and cancels its timer on disposal',
  (hold) => {
    vi.useFakeTimers();
    let dispose!: () => void;
    const controls = createRoot((cleanup) => {
      dispose = cleanup;
      return createRecordingControlsVisibility(() => false);
    });
    controls[hold](true);
    vi.advanceTimersByTime(5000);
    expect(controls.visible()).toBe(true);
    controls[hold](false);
    vi.advanceTimersByTime(2500);
    expect(controls.visible()).toBe(false);
    controls.show();
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  }
);
