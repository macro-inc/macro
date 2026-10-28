import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  changePlan,
  createScenario,
  includedCents,
  parseScenario,
  renew,
  setUsage,
} from './billing-simulation';

describe('billing-cycle UI fixtures', () => {
  it('keeps Max and its usage until the scheduled Pro renewal', () => {
    const max = createScenario('max');
    const scheduled = changePlan(max, 'premium');
    expect(scheduled.tier).toBe('max');
    expect(scheduled.scheduledPlan).toBe('premium');
    expect(scheduled.usedCents).toBe(max.usedCents);
    expect(scheduled.periodEnd).toBe(max.periodEnd);
    const renewed = renew(scheduled);
    expect(renewed.tier).toBe('premium');
    expect(renewed.scheduledPlan).toBeUndefined();
    expect(renewed.usedCents).toBe(0);
    expect(renewed.periodStart).toBe(max.periodEnd);
  });

  it('cancels a downgrade by keeping Max without resetting usage', () => {
    const before = createScenario('max-to-pro');
    const canceled = changePlan(before, 'max');
    expect(canceled.tier).toBe('max');
    expect(canceled.scheduledPlan).toBeUndefined();
    expect(canceled.usedCents).toBe(before.usedCents);
    expect(canceled.periodEnd).toBe(before.periodEnd);
  });

  it('upgrades Pro immediately and preserves the cycle and credits', () => {
    const before = createScenario('credits');
    const upgraded = changePlan(before, 'max');
    expect(upgraded.tier).toBe('max');
    expect(upgraded.usedCents).toBe(0);
    expect(upgraded.creditBalanceCents).toBe(before.creditBalanceCents);
    expect(upgraded.periodStart).toBe(before.periodStart);
    expect(upgraded.periodEnd).toBe(before.periodEnd);
  });

  it('carries prepaid credits into the next cycle', () => {
    const before = createScenario('credits');
    const after = renew(before);
    expect(after.creditBalanceCents).toBe(before.creditBalanceCents);
    expect(after.usedCents).toBe(0);
    expect(after.periodEnd).toBe('2026-12-01T12:00:00.000Z');
  });

  it('applies a scheduled cancellation at renewal', () => {
    const before = createScenario('canceling');
    expect(before.tier).toBe('premium');
    expect(renew(before).tier).toBe('free');
  });

  it('crosses renewal boundaries when advancing the clock', () => {
    const after = advanceDays(createScenario('max-to-pro'), 50);
    expect(after.tier).toBe('premium');
    expect(after.now).toBe('2026-12-04T12:00:00.000Z');
    expect(after.periodStart).toBe('2026-12-01T12:00:00.000Z');
    expect(after.periodEnd).toBe('2027-01-01T12:00:00.000Z');
  });

  it('does not let a team member change a paid seat', () => {
    const member = createScenario('team-member');
    expect(changePlan(member, 'premium')).toEqual(member);
  });

  it('keeps the owner allowance scoped to their own seat', () => {
    const owner = createScenario('team-owner');
    expect(includedCents(owner)).toBe(includedCents(createScenario('max')));
    expect(owner.usedCents / includedCents(owner)).toBe(0.75);
    expect(setUsage(owner, 100).usedCents).toBe(20_000);
  });

  it('uses the right limit state for free, paid, and funded accounts', () => {
    expect(setUsage(createScenario('free'), 100).blockedReason).toBe(
      'free_allowance_exhausted'
    );
    expect(setUsage(createScenario('pro'), 100).blockedReason).toBe(
      'allowance_exhausted'
    );
    expect(
      setUsage(createScenario('credits'), 100).blockedReason
    ).toBeUndefined();
    expect(
      setUsage(createScenario('unlimited'), 100).blockedReason
    ).toBeUndefined();
  });

  it('resets reload spend at the UTC month boundary, independently of subscription renewal', () => {
    const capped = {
      ...createScenario('spending-limit'),
      periodStart: '2026-09-20T12:00:00.000Z',
      periodEnd: '2026-10-20T12:00:00.000Z',
    };
    const renewed = renew(capped);
    expect(renewed.reloadSpentCents).toBe(5_000);
    expect(renewed.periodEnd).toBe('2026-11-20T12:00:00.000Z');
    const nextMonth = advanceDays(renewed, 12);
    expect(nextMonth.now).toBe('2026-11-01T12:00:00.000Z');
    expect(nextMonth.reloadSpentCents).toBe(0);
    expect(nextMonth.periodEnd).toBe(renewed.periodEnd);
    expect(nextMonth.autoReload.enabled).toBe(true);
  });

  it('handles unknown scenario links with the downgrade example', () => {
    expect(parseScenario('not-a-scenario')).toBe('max-to-pro');
    expect(parseScenario('payment-failed')).toBe('payment-failed');
  });
});
