import { afterEach, expect, it, vi } from 'vitest';
import { createHiddenDeferral } from './visible-refresh';

const setVisibility = (value: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
};
const dispatch = () => document.dispatchEvent(new Event('visibilitychange'));

afterEach(() => vi.restoreAllMocks());

it('runs every request synchronously while visible', () => {
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  deferral.request();
  deferral.request();
  expect(run).toHaveBeenCalledTimes(2);
  deferral.dispose();
});

it('coalesces hidden requests into one run on becoming visible', () => {
  setVisibility('hidden');
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  deferral.request();
  deferral.request();
  dispatch();
  expect(run).not.toHaveBeenCalled();

  setVisibility('visible');
  dispatch();
  dispatch();
  expect(run).toHaveBeenCalledTimes(1);
  deferral.dispose();
});

it('stays quiet when shown with nothing deferred or after disposal', () => {
  const run = vi.fn();
  const deferral = createHiddenDeferral(run);
  dispatch();
  expect(run).not.toHaveBeenCalled();

  setVisibility('hidden');
  deferral.request();
  deferral.dispose();
  setVisibility('visible');
  dispatch();
  expect(run).not.toHaveBeenCalled();
});
