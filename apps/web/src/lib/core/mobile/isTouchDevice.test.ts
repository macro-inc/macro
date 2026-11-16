import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const pointer = { matches: false };

async function loadIsTouchDevice() {
  const module = await import('./isTouchDevice');
  return module.isTouchDevice;
}

beforeEach(() => {
  vi.resetModules();
  pointer.matches = false;
  delete document.documentElement.dataset.touchDevice;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return pointer.matches;
      },
      addEventListener: () => {},
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('keeps the touch attribute in step when detection flips', async () => {
  const isTouchDevice = await loadIsTouchDevice();
  expect(isTouchDevice()).toBe(false);

  pointer.matches = true;
  window.dispatchEvent(new Event('resize'));
  expect(isTouchDevice()).toBe(true);
  expect(document.documentElement.dataset.touchDevice).toBe('true');

  pointer.matches = false;
  window.dispatchEvent(new Event('resize'));
  expect(isTouchDevice()).toBe(false);
  expect(document.documentElement.dataset.touchDevice).toBe('false');
});

it('leaves the attribute alone on a resize that changes nothing', async () => {
  const isTouchDevice = await loadIsTouchDevice();
  document.documentElement.dataset.touchDevice = 'true';

  window.dispatchEvent(new Event('resize'));
  expect(isTouchDevice()).toBe(false);
  expect(document.documentElement.dataset.touchDevice).toBe('true');
});
