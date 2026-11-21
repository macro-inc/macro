/**
 * Shrinks a sequence that found something to a short one that still does.
 *
 *   bun tests/channels-e2e/fuzz/shrink.ts <result.json> "<finding>" <work directory>
 *
 * The finding is named as `compare.ts` prints it: its kind, or its kind and
 * shape (`window differs at the end: a reply missing`).
 *
 * Run it against the build the result came from. It removes operations a
 * part at a time (delta debugging), running the candidates of each round
 * side by side, and keeps the shortest that still finds the same kind of
 * thing. `FUZZ_TRIES` runs every candidate that many times and counts it
 * as failing if any run does, for a finding that does not show every time.
 * `FUZZ_RUNNER` is the command that runs the fuzzer's Playwright config; it
 * gets `FUZZ_CASES` and `CHANNELS_E2E_RUN_DIR` in its environment.
 *
 * Writes `<work directory>/shrunk.json`: the sequence, how often it showed
 * in the last check, and what it found.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Case, describe, type Op } from './gen';
import type { Result } from './run';
import { isOne } from './shape';

const RUNNER =
  process.env.FUZZ_RUNNER ??
  'bunx playwright test --config tests/channels-e2e/fuzz/playwright.config.ts';
const TRIES = Number(process.env.FUZZ_TRIES ?? 1);
const MAX_ROUNDS = Number(process.env.FUZZ_SHRINK_ROUNDS ?? 14);

const [resultFile, kind, work] = process.argv.slice(2);
if (!resultFile || !kind || !work) {
  throw new Error('usage: shrink.ts <result.json> "<kind>" <work directory>');
}
const original = JSON.parse(readFileSync(resultFile, 'utf8')) as Result;
let round = 0;

/** Runs the candidates; answers, for each, in how many tries it showed. */
function showsIn(candidates: Op[][], tries = TRIES): number[] {
  round += 1;
  const directory = join(work, `round-${round}`);
  mkdirSync(directory, { recursive: true });
  const cases = candidates.flatMap((ops, index) =>
    Array.from({ length: tries }, (_, attempt) => ({
      id: `c${index}-t${attempt}`,
      seed: original.seed,
      profile: original.profile,
      ops,
    }))
  );
  const file = join(directory, 'cases.json');
  writeFileSync(file, JSON.stringify(cases));
  spawnSync('sh', ['-c', RUNNER], {
    env: { ...process.env, FUZZ_CASES: file, CHANNELS_E2E_RUN_DIR: directory },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return candidates.map((_, index) => {
    let shown = 0;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const out = join(
        directory,
        'fuzz',
        original.side,
        `c${index}-t${attempt}.json`
      );
      if (!existsSync(out)) continue;
      const result = JSON.parse(readFileSync(out, 'utf8')) as Result;
      if (result.findings.some((finding) => isOne(finding, kind))) shown += 1;
    }
    return shown;
  });
}

function without<T>(items: T[], from: number, to: number): T[] {
  return [...items.slice(0, from), ...items.slice(to)];
}

function shrink(start: Op[]): Op[] {
  let ops = start;
  let parts = 2;
  while (ops.length > 1 && round < MAX_ROUNDS) {
    const size = Math.ceil(ops.length / parts);
    const candidates: Op[][] = [];
    for (let from = 0; from < ops.length; from += size) {
      candidates.push(without(ops, from, from + size));
    }
    const shown = showsIn(candidates);
    const kept = candidates
      .filter((_, index) => shown[index] > 0)
      .sort((a, b) => a.length - b.length)[0];
    console.log(
      `round ${round}: ${ops.length} operations in ${candidates.length} parts → ${kept ? `${kept.length} still show it` : 'none shows it'}`
    );
    if (kept) {
      ops = kept;
      parts = Math.max(2, parts - 1);
    } else if (size === 1) {
      break;
    } else {
      parts = Math.min(ops.length, parts * 2);
    }
  }
  // Operations made at once, tried one at a time.
  const flat = ops.flatMap((op, index) =>
    op.k === 'par'
      ? op.ops.map((part) => [
          ...ops.slice(0, index),
          part,
          ...ops.slice(index + 1),
        ])
      : []
  );
  if (flat.length > 0 && round < MAX_ROUNDS + 2) {
    const shown = showsIn(flat);
    const kept = flat.find((_, index) => shown[index] > 0);
    if (kept) ops = kept;
  }
  return ops;
}

const ops = shrink(original.ops);
const checks = 3;
const [shown] = showsIn([ops], checks);
const shrunk: Case & { id: string } = {
  id: `${original.id}-shrunk`,
  seed: original.seed,
  profile: original.profile,
  ops,
};
writeFileSync(
  join(work, 'shrunk.json'),
  JSON.stringify(
    {
      kind,
      side: original.side,
      from: { id: original.id, operations: original.ops.length },
      shown: `${shown} of ${checks} runs`,
      steps: ops.map(describe),
      cases: [shrunk],
    },
    null,
    1
  )
);
console.log(
  `${original.id} (${original.side}), "${kind}": ${original.ops.length} → ${ops.length} operations, shown in ${shown} of ${checks} runs`
);
for (const op of ops) console.log(`  ${describe(op)}`);
