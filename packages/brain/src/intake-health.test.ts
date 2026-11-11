import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Brain } from './brain.ts';
import { dryRun } from './dry-run.ts';

test('stopped intake reports disconnected while its admitted turn still drains', async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'brain-intake-health-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../template/', import.meta.url), root, {
    recursive: true,
  });
  let checkedDuringDrain = false;
  await dryRun((deps) => {
    const brain = new Brain(deps);
    let lifetime: AbortSignal;
    return {
      async prepare(signal) {
        lifetime = signal;
        await brain.prepare(signal);
        assert.equal((await brain.health()).status, 'degraded');
      },
      run: (signal) => brain.run(signal),
      health: async () => {
        const health = await brain.health();
        if (lifetime.aborted && health.turns.length > 0) {
          checkedDuringDrain = true;
          assert.equal(health.connected, false);
          assert.equal(health.status, 'degraded');
        }
        return health;
      },
      post: (turn, channel, text) => brain.post(turn, channel, text),
      checkFixture: (fixture) => brain.checkFixture(fixture),
    };
  }, root);
  assert.equal(checkedDuringDrain, true);
});
