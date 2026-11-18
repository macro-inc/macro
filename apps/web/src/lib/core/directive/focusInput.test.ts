import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { triggerFocusInput, triggerFocusNewElement } from './focusInput';

const touch = vi.hoisted(() => ({ isTouchDevice: vi.fn(() => false) }));
vi.mock('@core/mobile/isTouchDevice', () => touch);
vi.mock('@core/util/platform', () => ({ isPlatform: () => false }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  touch.isTouchDevice.mockReturnValue(false);
});

it('transfers focus once despite several mutations before the timer runs', async () => {
  const input = document.createElement('input');
  Object.defineProperty(input, 'offsetParent', { value: document.body });
  const focus = vi.spyOn(input, 'focus');
  triggerFocusInput(() => document.querySelector('input'));
  document.body.append(input);
  await Promise.resolve();
  document.body.append(document.createElement('div'));
  await Promise.resolve();
  document.body.append(document.createElement('div'));
  await Promise.resolve();
  vi.runAllTimers();
  expect(focus).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(input);
});

it('cancels a queued focus transfer when the page unloads', async () => {
  const input = document.createElement('input');
  Object.defineProperty(input, 'offsetParent', { value: document.body });
  const focus = vi.spyOn(input, 'focus');
  triggerFocusInput(() => document.querySelector('input'));
  document.body.append(input);
  await Promise.resolve();
  window.dispatchEvent(new Event('beforeunload'));
  vi.runAllTimers();
  expect(focus).not.toHaveBeenCalled();
});

function mountField() {
  const input = document.createElement('input');
  input.setAttribute('data-field', '');
  Object.defineProperty(input, 'offsetParent', { value: document.body });
  document.body.append(input);
  return input;
}

it('focuses the newly mounted match, not one already on the page', async () => {
  const closing = mountField();
  const closingFocus = vi.spyOn(closing, 'focus');
  triggerFocusNewElement('[data-field]');
  const opened = mountField();
  await Promise.resolve();
  vi.runAllTimers();
  expect(closingFocus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opened);
});

it('leaves focus to the opened view without a touch screen when touchOnly', async () => {
  triggerFocusNewElement('[data-field]', { touchOnly: true });
  const opened = mountField();
  await Promise.resolve();
  vi.runAllTimers();
  expect(document.activeElement).not.toBe(opened);
});

it('focuses on a touch screen when touchOnly', async () => {
  touch.isTouchDevice.mockReturnValue(true);
  triggerFocusNewElement('[data-field]', { touchOnly: true });
  const opened = mountField();
  await Promise.resolve();
  vi.runAllTimers();
  expect(document.activeElement).toBe(opened);
});

it('leaves a stand-in already holding the keyboard alone', async () => {
  const standIn = document.createElement('input');
  standIn.setAttribute('data-focus-stand-in', '');
  document.body.append(standIn);
  standIn.focus();
  triggerFocusNewElement('[data-field]');
  mountField();
  await Promise.resolve();
  vi.runAllTimers();
  expect(document.activeElement).toBe(standIn);
});
