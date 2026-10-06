import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissBootShell, rememberBootShell } from './boot-shell';

const HINT_KEY = 'macro:boot-shell';

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('rememberBootShell', () => {
  it('merges each part of the layout into one hint', () => {
    rememberBootShell({ rail: ['home', 'mail'] });
    rememberBootShell({ homeComposer: 'agents' });

    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? '')).toEqual({
      rail: ['home', 'mail'],
      homeComposer: 'agents',
    });
  });

  it('replaces a part that changed', () => {
    rememberBootShell({ rail: ['home', 'mail'] });
    rememberBootShell({ rail: ['home'] });

    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? '').rail).toEqual([
      'home',
    ]);
  });

  it('replaces a corrupt hint', () => {
    localStorage.setItem(HINT_KEY, '{not json');

    rememberBootShell({ mobileApp: false });

    expect(JSON.parse(localStorage.getItem(HINT_KEY) ?? '')).toEqual({
      mobileApp: false,
    });
  });
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
