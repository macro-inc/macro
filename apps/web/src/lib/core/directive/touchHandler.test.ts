import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { touchHandler } from './touchHandler';

vi.mock('@tauri-apps/plugin-haptics', () => ({
  impactFeedback: vi.fn(async () => {}),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));

let dispose: () => void;
let element: HTMLElement;
const onLongPress = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  element = document.createElement('div');
  document.body.append(element);
  createRoot((d) => {
    dispose = d;
    touchHandler(element, () => ({ onLongPress }));
  });
});
afterEach(() => {
  dispose();
  element.remove();
  vi.useRealTimers();
});

function touch(type: string, x = 20, y = 20) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  element.dispatchEvent(event);
}

it('gives a long press a medium impact as it opens', () => {
  touch('touchstart');
  vi.advanceTimersByTime(499);
  expect(impactFeedback).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('medium');
  expect(onLongPress).toHaveBeenCalledOnce();
});

it('gives a tap or a press that moves away no impact', () => {
  touch('touchstart');
  touch('touchend');
  touch('touchstart');
  touch('touchmove', 60, 20);
  vi.runAllTimers();
  expect(impactFeedback).not.toHaveBeenCalled();
  expect(onLongPress).not.toHaveBeenCalled();
});
