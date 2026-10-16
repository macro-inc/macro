import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { triggerFocusInput } from './focusInput';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/platform', () => ({ isPlatform: () => false }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
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
