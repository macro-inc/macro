import { expect, test } from '@playwright/test';

// QUEUE_SALVAGE_SCHEDULES and QUEUE_SALVAGE_SEED run more of them, or one again.
const SCHEDULES = Number(process.env.QUEUE_SALVAGE_SCHEDULES ?? 12);
const FIRST_SEED = Number(process.env.QUEUE_SALVAGE_SEED ?? 1);

test('engines killed anywhere in a recovery wipe lose no accepted write and bring none back', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000 + SCHEDULES * 15_000);
  const path = testInfo.project.name.includes('production')
    ? '/app/queue-salvage.html'
    : '/queue-salvage.html';
  await page.goto(path);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const recoveryMs = await page.evaluate(() =>
    window.queueSalvageHarness.measureRecovery()
  );
  const landings = new Map<string, number>();
  const outcomes = new Map<string, number>();
  const totals = { kills: 0, wipes: 0, accepted: 0, settled: 0 };
  const violations: string[] = [];
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SCHEDULES; seed += 1) {
    const report = await page.evaluate(
      ([seed, recoveryMs]) => window.queueSalvageHarness.run(seed, recoveryMs),
      [seed, recoveryMs * 1.2] as const
    );
    for (const landing of report.kills)
      landings.set(landing, (landings.get(landing) ?? 0) + 1);
    for (const outcome of report.outcomes)
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    totals.kills += report.kills.length;
    totals.wipes += report.wipes;
    totals.accepted += report.accepted;
    totals.settled += report.settled;
    if (report.violations.length > 0) console.log(seed, report.trace);
    violations.push(
      ...report.violations.map((violation) => `seed ${seed}: ${violation}`)
    );
  }
  testInfo.annotations.push({
    type: 'coverage',
    description: JSON.stringify({
      schedules: SCHEDULES,
      recoveryMs: Math.round(recoveryMs),
      ...totals,
      landings: Object.fromEntries(landings),
      outcomes: Object.fromEntries(outcomes),
    }),
  });
  console.log(testInfo.annotations.at(-1)?.description);
  expect(violations).toEqual([]);
});
