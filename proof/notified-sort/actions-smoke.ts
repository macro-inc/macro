// Runs every step kind a few times for one viewer and prints the outcome.
import { join } from 'node:path';
import { runStep, STEP_WEIGHTS, type ActionContext } from './lib/actions.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';
const out = join(import.meta.dirname, 'out/smoke');
const stack = stackFromEnv();
const seeded = await seedWorld(stack, { seed: 902, lanes: 1, sizes: [], outDir: out, repo: process.env.PROOF_REPO ?? '', instance: 'gqlns', log: console.log, reuse: true });
const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world: seeded.world, users: seeded.users, viewer: 'v0', rng: new Rng(5), created: [] };
for (const [kind] of STEP_WEIGHTS) {
  for (let i = 0; i < (kind === "create" || kind === "mentions-only" ? 3 : 0); i++) {
    const r = await runStep(ctx, kind);
    console.log(JSON.stringify(r));
  }
}
