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
