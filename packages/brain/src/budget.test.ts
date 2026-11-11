import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SpendLedger } from './budget.ts';

test('simultaneous call and work costs survive restart without lost updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brain-budget-'));
  try {
    const ledger = new SpendLedger(dir, () => '2026-01-01');
    await Promise.all([ledger.record(1), ledger.record(2), ledger.record(3)]);
    assert.equal(
      await new SpendLedger(dir, () => '2026-01-01').spentToday(),
      6
    );
    assert.equal(
      await new SpendLedger(dir, () => '2026-01-02').spentToday(),
      0
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('admitted caps survive a crash and a known final cost refunds only once', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'brain-reserve-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = new SpendLedger(dir, () => '2026-01-01');
  const reservation = await ledger.reserve(10, 50);
  assert.equal(await new SpendLedger(dir, () => '2026-01-01').spentToday(), 10);
  await Promise.all([
    reservation.settle(2),
    reservation.settle(2),
    reservation.settle(2),
  ]);
  assert.equal(await ledger.spentToday(), 2);
});

test('a refund is bound to the admission day and never credits the next day', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'brain-reserve-day-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let day = '2026-01-01';
  const ledger = new SpendLedger(dir, () => day);
  const reservation = await ledger.reserve(10, 50);
  day = '2026-01-02';
  await ledger.record(3);
  assert.deepEqual(await reservation.settle(1), {
    spentTodayUsd: 3,
    accountedUsd: 10,
  });
  assert.equal(await ledger.spentToday(), 3);
  assert.equal(await new SpendLedger(dir, () => day).spentToday(), 3);
});

test('a failed refund retains the charge and is never applied again', async (t) => {
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'brain-refund-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = new SpendLedger(dir);
  const reservation = await ledger.reserve(10, 50);
  await mkdir(join(dir, 'spend.json.tmp'));
  const failed = reservation.settle(2);
  await assert.rejects(failed, /EISDIR/);
  assert.equal(await ledger.spentToday(), 10);
  await rm(join(dir, 'spend.json.tmp'), { recursive: true });
  assert.equal(reservation.settle(2), failed);
  await assert.rejects(reservation.settle(2), /EISDIR/);
  await ledger.record(3);
  assert.equal(await ledger.spentToday(), 13);
});
