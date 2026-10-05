import { describe, expect, it } from 'vitest';
import {
  isUsageAvailable,
  monthlyUsagePercent,
  parseDollarInput,
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
