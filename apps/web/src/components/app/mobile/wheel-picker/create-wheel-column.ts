import { debounce } from '@core/util/debounce';
import { createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  WHEEL_ROW_HEIGHT,
  type WheelOption,
  wheelCenterIndex,
  wheelSnapIndex,
  wheelValueIndex,
} from './wheel-values';

// Safari 16.4 has no scrollend event. Wait for native momentum and snap scrolling
// to stop, and never commit while the pointer still owns a drag.
const WHEEL_SETTLE_DELAY_MS = 150;

export function createWheelColumn(options: {
  options: () => readonly WheelOption[];
  value: () => string;
  loop: () => boolean;
  disabled: () => boolean;
  element: () => HTMLElement | undefined;
  onChange: (value: string) => void;
}) {
  const [state, setState] = createStore({
    position: 0,
    dragging: false,
    touching: false,
  });
  const align = (index: number) => {
    const element = options.element();
    if (element) element.scrollTop = index * WHEEL_ROW_HEIGHT;
    setState('position', index);
  };
  const selectedIndex = () =>
    Math.max(
      0,
      options.options().findIndex((item) => item.value === options.value())
    );
  const reset = () => {
    settleLater.clear();
    setState({ dragging: false, touching: false });
    align(
      wheelCenterIndex(
        selectedIndex(),
        options.options().length,
        options.loop()
      )
    );
  };
  let committing = false;
  const commit = (index: number) => {
    const items = options.options();
    if (options.disabled() || items.length === 0) return;
    const logical = options.loop()
      ? wheelValueIndex(index, items.length)
      : index;
    const item = items[logical];
    if (!item) return;
    committing = true;
    try {
      if (item.value !== options.value()) options.onChange(item.value);
    } finally {
      committing = false;
      // Align once to the controlled result, including a rejected or clamped pick.
      reset();
    }
  };
  const settle = () => {
    settleLater.clear();
    if (state.dragging || options.disabled()) return;
    commit(
      wheelSnapIndex(
        options.element()?.scrollTop ?? 0,
        options.options().length,
        options.loop()
      )
    );
  };
  const settleLater = debounce(settle, WHEEL_SETTLE_DELAY_MS);
  const schedule = () => {
    settleLater.clear();
    if (!state.dragging) settleLater();
  };
  const scroll = () => {
    if (options.disabled()) return;
    setState(
      'position',
      (options.element()?.scrollTop ?? 0) / WHEEL_ROW_HEIGHT
    );
    schedule();
  };
  const pointerDown = () => {
    settleLater.clear();
    if (!options.disabled()) setState('dragging', true);
  };
  const touchStart = () => {
    pointerDown();
    if (!options.disabled()) setState('touching', true);
  };
  const touchEnd = () => {
    setState('touching', false);
    pointerUp();
  };
  const pointerUp = () => {
    // Native touch scrolling cancels Pointer Events before the finger lifts.
    // Touch Events retain ownership until touchend, then momentum can settle.
    if (state.touching) return;
    if (!state.dragging) return;
    setState('dragging', false);
    schedule();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (options.disabled()) return;
    const index = selectedIndex();
    let next: number;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft')
      next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.options().length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    settleLater.clear();
    if (!options.loop())
      next = Math.max(0, Math.min(options.options().length - 1, next));
    commit(next);
  };
  createEffect(
    on([options.value, options.options, options.disabled, options.loop], () => {
      if (!committing) reset();
    })
  );
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);
  window.addEventListener('touchend', touchEnd);
  window.addEventListener('touchcancel', touchEnd);
  onCleanup(() => {
    settleLater.clear();
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerUp);
    window.removeEventListener('touchend', touchEnd);
    window.removeEventListener('touchcancel', touchEnd);
  });
  return {
    state,
    selectedIndex,
    scroll,
    pointerDown,
    touchStart,
    keyDown,
    choose: commit,
  };
}
