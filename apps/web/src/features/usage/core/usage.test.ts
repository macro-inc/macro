import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_RELOAD,
  describePaymentAction,
  isUsageAvailable,
  monthlyUsagePercent,
  parseDollarInput,
  validateAutoReload,
} from './usage';

describe('monthly usage', () => {
  it('measures included usage and clamps usage beyond the allowance', () => {
    expect(monthlyUsagePercent(1_000, 4_000)).toBe(25);
    expect(monthlyUsagePercent(6_000, 4_000)).toBe(100);
    expect(monthlyUsagePercent(0, 0)).toBe(0);
    expect(monthlyUsagePercent(100, 0)).toBe(100);
  });
});

describe('dollar inputs', () => {
  it('preserves cents and rejects fractional cents, exponents and invalid amounts', () => {
    expect(parseDollarInput('25')).toBe(2_500);
    expect(parseDollarInput(' 50.01 ')).toBe(5_001);
    expect(parseDollarInput('10.1')).toBe(1_010);
    for (const value of [
      '',
      '0',
      '-10',
      '1e2',
      '25.001',
      'NaN',
      '999999999999999999',
    ]) {
      expect(parseDollarInput(value)).toBeUndefined();
    }
  });
});

describe('Auto-Reload validation', () => {
  it('requires the target to exceed the minimum by the smallest chargeable reload', () => {
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        minimumBalanceCents: 1_000,
        targetBalanceCents: 1_049,
      })
    ).toBe(
      'Target balance must be greater than minimum balance by at least $0.50.'
    );
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        minimumBalanceCents: 1_000,
        targetBalanceCents: 1_050,
      })
    ).toBeUndefined();
  });

  it('caps the target balance at $5,000', () => {
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        targetBalanceCents: 500_001,
      })
    ).toBe('Target balance can be at most $5,000.');
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        targetBalanceCents: 500_000,
      })
    ).toBeUndefined();
  });

  it('requires a monthly spend limit of at least $5 when one is set', () => {
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        monthlySpendLimitCents: 499,
      })
    ).toBe('Monthly spend limit must be at least $5, or leave it blank.');
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        monthlySpendLimitCents: 500,
      })
    ).toBeUndefined();
    expect(
      validateAutoReload({
        ...DEFAULT_AUTO_RELOAD,
        monthlySpendLimitCents: null,
      })
    ).toBeUndefined();
  });
});

describe('Usage rollout', () => {
  it.each([
    { production: false, flag: false, available: true },
    { production: false, flag: true, available: true },
    { production: false, flag: undefined, available: true },
    { production: true, flag: false, available: false },
    { production: true, flag: true, available: true },
    { production: true, flag: undefined, available: false },
  ])(
    'production=$production flag=$flag yields available=$available',
    ({ production, flag, available }) => {
      expect(isUsageAvailable(production, flag)).toBe(available);
    }
  );
});

describe('payment awaiting authentication', () => {
  it('names the feature that is paused and the amount to confirm', () => {
    expect(
      describePaymentAction({ kind: 'credit_reload', amountCents: 9_500 })
    ).toBe(
      'An automatic reload of $95 needs you to confirm it with your bank. Automatic reload is paused until you do.'
    );
    expect(
      describePaymentAction({
        kind: 'overage_charge',
        amountCents: 1_575,
        url: 'https://invoice.stripe.test/i/in_1',
      })
    ).toBe(
      'A usage charge of $15.75 needs you to confirm it with your bank. Usage billing is paused until you do.'
    );
  });
});
