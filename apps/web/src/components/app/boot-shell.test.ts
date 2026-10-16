import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissBootShell } from './boot-shell';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('dismissBootShell', () => {
  it('fades the shell, then removes it', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="boot-shell"></div>';

    dismissBootShell();

    expect(document.getElementById('boot-shell')?.dataset.leaving).toBe('');
    vi.advanceTimersByTime(400);
    expect(document.getElementById('boot-shell')).toBeNull();
  });

  it('does nothing once the shell is gone', () => {
    expect(() => dismissBootShell()).not.toThrow();
  });
});
