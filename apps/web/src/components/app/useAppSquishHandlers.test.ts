import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppSquishHandlers } from './useAppSquishHandlers';

vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => true,
}));
vi.mock('@core/util/platform', () => ({ isPlatform: () => false }));

let viewport: EventTarget & { height: number };
const dvh = () => document.documentElement.style.getPropertyValue('--dvh');

beforeEach(() => {
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
  viewport = Object.assign(new EventTarget(), { height: 600 });
  vi.stubGlobal('visualViewport', viewport);
  render(() => {
    useAppSquishHandlers();
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
});

it('remeasures keyboard clearance after a fold or rotation without a keyboard event', () => {
  window.dispatchEvent(
    new CustomEvent('keyboardWillShow', { detail: { height: 300 } })
  );
  expect(dvh()).toBe('3px');
  viewport.height = 900;
  window.dispatchEvent(new Event('resize'));
  expect(dvh()).toBe('6px');
  viewport.height = 700;
  viewport.dispatchEvent(new Event('resize'));
  expect(dvh()).toBe('4px');
});

it('uses the full new viewport with a hardware keyboard and restores dynamic height on hide', () => {
  window.dispatchEvent(
    new CustomEvent('keyboardWillShow', { detail: { height: 0 } })
  );
  viewport.height = 900;
  window.dispatchEvent(new Event('resize'));
  expect(dvh()).toBe('9px');
  window.dispatchEvent(new CustomEvent('keyboardWillHide'));
  viewport.height = 600;
  viewport.dispatchEvent(new Event('resize'));
  expect(dvh()).toBe('1dvh');
});
