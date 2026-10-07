import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_RELOAD } from '../core/usage';
import { createAutoReloadForm } from './auto-reload-form';

describe('Auto-Reload form', () => {
  it('defaults to $10/$100, accepts an optional cap and rejects an inverted balance range', () => {
    const form = createAutoReloadForm(DEFAULT_AUTO_RELOAD);
    expect(form.error()).toBeUndefined();
    expect(form.settings()).toEqual({ ...DEFAULT_AUTO_RELOAD, enabled: true });
    form.setMaximum('125.50');
    expect(form.settings()?.monthlySpendLimitCents).toBe(12_550);
    form.setTarget('5');
    expect(form.error()).toContain('Target balance must be greater');
    form.setTarget('100');
    form.setMaximum('');
    expect(form.settings()?.monthlySpendLimitCents).toBeNull();
  });
});
