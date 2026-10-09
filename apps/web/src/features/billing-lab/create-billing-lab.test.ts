import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBillingLab } from './create-billing-lab';

describe('billing lab actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds credits only after the simulated checkout completes', async () => {
    const lab = createBillingLab('credits');
    const checkout = lab.usage.checkout.start(2_500);
    await vi.runAllTimersAsync();
    await checkout;
    expect(lab.payment()).toEqual({ kind: 'credits', amountCents: 2_500 });
    expect(lab.state().creditBalanceCents).toBe(2_500);
    const payment = lab.completePayment();
    await vi.runAllTimersAsync();
    await payment;
    expect(lab.state().creditBalanceCents).toBe(5_000);
    expect(lab.payment()).toBeUndefined();
  });

  it('fails one checkout without changing the balance, then permits a retry', async () => {
    const lab = createBillingLab('pro');
    lab.setFailNext(true);
    const failed = expect(lab.usage.checkout.start(2_500)).rejects.toThrow(
      'Simulated billing request failure'
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(lab.state().creditBalanceCents).toBe(0);
    expect(lab.payment()).toBeUndefined();
    expect(lab.failNext()).toBe(false);
    expect(lab.pending()).toBe(false);
    const retry = lab.usage.checkout.start(2_500);
    await vi.runAllTimersAsync();
    await retry;
    expect(lab.payment()?.kind).toBe('credits');
  });

  it('keeps manual purchases outside the reload budget and preserves spend when raising the cap', async () => {
    const lab = createBillingLab('spending-limit');
    expect(lab.usage.autoReload.budget?.()).toEqual({
      limitCents: 5_000,
      spentCents: 5_000,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
    const checkout = lab.usage.checkout.start(2_500);
    await vi.runAllTimersAsync();
    await checkout;
    const complete = lab.completePayment();
    await vi.runAllTimersAsync();
    await complete;
    expect(lab.state().creditBalanceCents).toBe(2_500);
    expect(lab.usage.autoReload.budget?.()?.spentCents).toBe(5_000);
    const save = lab.usage.autoReload.save({
      ...lab.state().autoReload,
      monthlySpendLimitCents: 10_000,
    });
    await vi.runAllTimersAsync();
    await save;
    expect(lab.usage.autoReload.budget?.()).toMatchObject({
      limitCents: 10_000,
      spentCents: 5_000,
    });
  });

  it('rejects billing actions for a team-paid member without opening a payment flow or changing settings', async () => {
    const lab = createBillingLab('team-member');
    await expect(lab.usage.checkout.start(2_500)).rejects.toThrow(
      'Credit purchase unavailable'
    );
    await expect(
      lab.usage.autoReload.save({ ...lab.state().autoReload, enabled: true })
    ).rejects.toThrow('Auto-Reload unavailable');
    await expect(lab.usage.paymentMethods.open()).rejects.toThrow(
      'Payment methods unavailable'
    );
    expect(lab.payment()).toBeUndefined();
    expect(lab.pending()).toBe(false);
    expect(lab.state().autoReload.enabled).toBe(false);
  });

  it.each([
    'team-owner',
    'team-owner-exhausted',
    'team-owner-reload-paused',
    'team-owner-spending-limit',
  ] as const)(
    'lets the payer manage shared credits in %s',
    async (scenario) => {
      const lab = createBillingLab(scenario);
      expect(lab.surface()).toBe('usage');
      expect(lab.usage.summary()?.billingAccess).toBe('payer');
      expect(lab.billing.teamSeatDescription()).toBe(
        '4 users • 3 Pro seats, 1 Max seat'
      );
      const before = lab.state().creditBalanceCents;
      const spent = lab.state().reloadSpentCents;
      const checkout = lab.usage.checkout.start(2_500);
      await vi.runAllTimersAsync();
      await checkout;
      const complete = lab.completePayment();
      await vi.runAllTimersAsync();
      await complete;
      expect(lab.state().creditBalanceCents).toBe(before + 2_500);
      expect(lab.state().reloadSpentCents).toBe(spent);
      expect(lab.notice()).toBe('Credits added to the shared team balance');
      const save = lab.usage.autoReload.save({
        enabled: true,
        minimumBalanceCents: 1_000,
        targetBalanceCents: 10_000,
        monthlySpendLimitCents: 10_000,
      });
      await vi.runAllTimersAsync();
      await save;
      expect(lab.state().autoReload.monthlySpendLimitCents).toBe(10_000);
      expect(lab.state().reloadSuspended).toBe(false);
      expect(lab.state().role).toBe('owner');
    }
  );

  it('discards an in-flight plan change after selecting another scenario', async () => {
    const lab = createBillingLab('pro');
    const upgrade = lab.billing.changePlan('max');
    lab.selectScenario('free');
    await vi.runAllTimersAsync();
    await upgrade;
    expect(lab.state().tier).toBe('free');
    expect(lab.state().usedCents).toBe(45);
    expect(lab.events()).toEqual([]);
    expect(lab.pending()).toBe(false);
  });

  it('retains a failed payment for retry without activating the subscription', async () => {
    const lab = createBillingLab('free');
    const checkout = lab.billing.checkout('max');
    await vi.runAllTimersAsync();
    await checkout;
    lab.setFailNext(true);
    const failed = expect(lab.completePayment()).rejects.toThrow();
    await vi.runAllTimersAsync();
    await failed;
    expect(lab.state().tier).toBe('free');
    expect(lab.payment()?.kind).toBe('subscription');
    const retry = lab.completePayment();
    await vi.runAllTimersAsync();
    await retry;
    expect(lab.state().tier).toBe('max');
    expect(lab.state().usedCents).toBe(0);
    expect(lab.payment()).toBeUndefined();
  });
});
