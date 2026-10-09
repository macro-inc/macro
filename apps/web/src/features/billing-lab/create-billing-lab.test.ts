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
