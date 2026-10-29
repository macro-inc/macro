import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFlowProgress, readSavedStep, saveStep } from './flow-storage';

const VIEWER = 'macro|ada@acme.com';
const realLocalStorage = window.localStorage;

function blockLocalStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: realLocalStorage,
  });
  vi.restoreAllMocks();
});

describe('onboarding step storage', () => {
  it('keeps progress in the tab when localStorage access is blocked', () => {
    blockLocalStorage();
    saveStep(VIEWER, 'team');
    expect(readSavedStep(VIEWER)).toBe('team');
    clearFlowProgress();
    expect(readSavedStep(VIEWER)).toBeUndefined();
  });

  it('keeps the tab copy when a localStorage write fails', () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (this === realLocalStorage) throw new DOMException('Full');
      setItem.call(this, key, value);
    });
    saveStep(VIEWER, 'plan');
    expect(sessionStorage.getItem('onboarding-flow-step')).toContain('plan');
    expect(readSavedStep(VIEWER)).toBe('plan');
  });
});
