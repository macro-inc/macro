import { describe, expect, it } from 'vitest';
import { cacheArmFor, cacheEnabledFor } from './rollout';

describe('render cache rollout', () => {
  it('caches only for an experiment test arm, or a plain flag that is on', () => {
    expect(cacheEnabledFor({ enabled: true, variant: 'test' })).toBe(true);
    // PostHog reports every variant as enabled, control included.
    expect(cacheEnabledFor({ enabled: true, variant: 'control' })).toBe(false);
    expect(cacheEnabledFor({ enabled: true })).toBe(true);
    expect(cacheEnabledFor({ enabled: false })).toBe(false);
  });
  it('reports an arm only for enrolled viewers', () => {
    expect(cacheArmFor({ enabled: true, variant: 'control' })).toBe('control');
    expect(cacheArmFor({ enabled: true, variant: 'test' })).toBe('test');
    expect(cacheArmFor({ enabled: true })).toBe('enabled');
    expect(cacheArmFor({ enabled: false })).toBeUndefined();
  });
});
