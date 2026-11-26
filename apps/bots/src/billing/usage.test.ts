import { expect, test } from 'bun:test';
import { fixtureBilling, sampleTeam } from './fixture';
import { dateRange, summarizeUsage } from './usage';

test('the fixture reconciles the observed dates, agent estimates, and team totals', async () => {
  const result = await fixtureBilling(null)(sampleTeam);

  if (result.status !== 'ready' || result.value.usage.status !== 'ready') {
    throw new Error('Expected sample usage');
  }

  const usage = result.value.usage.value;
  const total = summarizeUsage(usage);
  if (!total) throw new Error('Expected reconciled usage');
  expect(dateRange(usage.cycle.start, usage.cycle.end)).toBe(
    'Nov 1 – Nov 30, 2026 · UTC'
  );
  expect(total.days).toHaveLength(25);
  expect(total.days[0]).toEqual({ label: 'Nov 1', hours: 0 });
  expect(total.days[12]).toEqual({ label: 'Nov 13', hours: 8 });
  expect(total.days.at(-1)).toEqual({ label: 'Nov 25', hours: 7 });
  expect(total.peak).toBe(8);
  expect(total.agents).toEqual([
    { name: 'Sable', hours: 78, rateMinor: 1500, estimateMinor: 117000 },
    { name: 'Quill', hours: 46, rateMinor: 1500, estimateMinor: 69000 },
  ]);
  expect(total.hours).toBe(124);
  expect(total.estimateMinor).toBe(186000);
  expect(usage.billedMinor).toEqual({ status: 'ready', value: 0 });
  expect(result.value.invoices).toEqual({
    status: 'ready',
    value: {
      currency: 'USD',
      nextInvoice: { amount: 30000, date: '2026-12-01' },
    },
  });
  expect(result.value.modeledSpend).toEqual({ status: 'pending' });
});

test('the reader denies another team and distinguishes pending, absent, and zero readings', async () => {
  expect(
    await fixtureBilling(null)({ id: 'other-team', name: 'Other team' })
  ).toEqual({
    status: 'denied',
  });
  expect(await fixtureBilling('pending')(sampleTeam)).toEqual({
    status: 'pending',
  });
  expect(await fixtureBilling('empty')(sampleTeam)).toEqual({
    status: 'ready',
    value: {
      usage: { status: 'empty' },
      invoices: { status: 'empty' },
      modeledSpend: { status: 'empty' },
    },
  });

  const zero = await fixtureBilling('zero')(sampleTeam);
  if (zero.status !== 'ready' || zero.value.usage.status !== 'ready') {
    throw new Error('Expected observed zero usage');
  }
  expect(summarizeUsage(zero.value.usage.value)?.hours).toBe(0);
});

test('rejects incomplete or extra ledger days instead of publishing conflicting totals', async () => {
  const result = await fixtureBilling(null)(sampleTeam);

  if (result.status !== 'ready' || result.value.usage.status !== 'ready') {
    throw new Error('Expected sample usage');
  }

  const usage = result.value.usage.value;
  expect(
    summarizeUsage({ ...usage, observedThrough: '2026-11-24' })
  ).toBeUndefined();
  expect(
    summarizeUsage({ ...usage, observedThrough: '2026-11-26' })
  ).toBeUndefined();
  expect(
    summarizeUsage({ ...usage, observedThrough: '2026-12-01' })
  ).toBeUndefined();
});
