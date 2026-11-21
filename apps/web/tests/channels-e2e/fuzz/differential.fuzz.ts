import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, LOCAL_SYNC_BUILD, test } from '../harness/fixtures';
import { runDirectory } from '../harness/stack';
import { type Case, generate } from './gen';
import type { Side } from './model';
import { Run } from './run';
import { isOne, nameOf } from './shape';

/**
 * One test for each sequence. `FUZZ_SEEDS` names the seeds to generate
 * (`1-60`, or `3,17`), `FUZZ_LENGTH` how many operations each has;
 * `FUZZ_CASES` names a file of sequences instead, which is how a shrunk one
 * is run again. What a sequence found is written to the run directory, under
 * `fuzz/<off|on>/`; the test itself fails only when asked to with
 * `FUZZ_FAIL_ON`, so that a whole run always ends with every sequence
 * recorded.
 */
type Named = Case & { id: string };

function seeds(spec: string): number[] {
  return spec.split(',').flatMap((part) => {
    const [from, to] = part.split('-').map(Number);
    return Array.from(
      { length: (to ?? from) - from + 1 },
      (_, index) => from + index
    );
  });
}

function cases(): Named[] {
  const file = process.env.FUZZ_CASES;
  if (file) {
    // A list of sequences, or what `shrink.ts` wrote.
    const read = JSON.parse(readFileSync(file, 'utf8')) as
      | Named[]
      | { cases: Named[] };
    return Array.isArray(read) ? read : read.cases;
  }
  const length = Number(process.env.FUZZ_LENGTH ?? 40);
  return seeds(process.env.FUZZ_SEEDS ?? '1-4').map((seed) => ({
    ...generate(seed, length),
    id: `seed-${seed}`,
  }));
}

const SIDE: Side = LOCAL_SYNC_BUILD ? 'on' : 'off';

for (const kase of cases()) {
  test(`sequence ${kase.id}`, async ({ browser, ada, ben, cy, dee }) => {
    const directory = join(runDirectory(), 'fuzz', SIDE);
    mkdirSync(directory, { recursive: true });
    const run = new Run(browser, { ada, ben, cy, dee }, SIDE, kase, directory);
    const file = join(directory, `${kase.id}.json`);
    try {
      const result = await run.all();
      writeFileSync(file, JSON.stringify(result, null, 1));
      const wanted = process.env.FUZZ_FAIL_ON;
      if (wanted) {
        expect(
          result.findings
            .filter((finding) => isOne(finding, wanted))
            .map(nameOf),
          'what the sequence found'
        ).toEqual([]);
      }
    } catch (error) {
      writeFileSync(
        `${file}.failed`,
        JSON.stringify({ error: String(error), ...run.partial() }, null, 1)
      );
      throw error;
    } finally {
      await run.close();
    }
  });
}
