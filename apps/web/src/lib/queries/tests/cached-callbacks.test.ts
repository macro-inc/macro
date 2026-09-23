// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('releases callers while cached query callbacks remain alive', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--expose-gc',
      fileURLToPath(new URL('./cached-callbacks-gc.mjs', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 30_000 }
  );
  const reports: {
    hook: string;
    retained?: number;
    cachedOptions?: number;
    error?: string;
  }[] = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  expect(reports).toHaveLength(21);
  for (const report of reports) {
    expect(report.error, report.hook).toBeUndefined();
    expect(report.cachedOptions, report.hook).toBeGreaterThan(0);
    expect(report.retained, report.hook).toBe(
      report.hook === 'useLeakingQuery' ? 25 : 0
    );
  }
}, 30_000);
