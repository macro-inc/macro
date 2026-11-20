// Brings one seed's world into the stack: the scenario through seed-scenario,
// the extra kinds in SQL, sign-in for every viewer, and the background of
// notifications each read and sequence starts from.

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sqlNotifyStatement, uuidV7 } from './notify.ts';
import { Rng } from './rng.ts';
import { execFileSql, signIn, type Stack, type User } from './stack.ts';
import { buildWorld, type Entity, type World } from './world.ts';

const run = promisify(execFile);

export type Seeded = {
  world: World;
  users: Map<string, User>;
};

export async function seedWorld(
  stack: Stack,
  options: {
    seed: number;
    lanes: number;
    sizes: number[];
    outDir: string;
    repo: string;
    instance: string;
    log: (line: string) => void;
    /** The world is already in the stack (same seed): only sign in. */
    reuse?: boolean;
  }
): Promise<Seeded> {
  mkdirSync(options.outDir, { recursive: true });
  const world = buildWorld({ seed: options.seed, lanes: options.lanes, sizes: options.sizes, outDir: options.outDir });
  if (options.reuse) return { world, users: await signInAll(stack, world) };
  options.log(`seed ${options.seed}: applying ${world.scenarioFile}`);
  await run('just', ['seed-scenario', '--instance', options.instance, 'apply', '--file', world.scenarioFile], {
    cwd: options.repo,
    maxBuffer: 64 * 1024 * 1024,
  });
  const extra = join(options.outDir, `${world.scenario}.extra.sql`);
  writeFileSync(extra, `BEGIN;\n${world.extraSql}COMMIT;\n`);
  await execFileSql(stack, extra);

  const users = await signInAll(stack, world);

  // Background notifications, written at exact times so every read starts
  // with ties, old and recent rows, read and done states across every kind.
  const rng = new Rng(options.seed * 31 + 5);
  const statements: string[] = [];
  const now = Date.now();
  const tie = new Date(now - 3 * 3600_000);
  for (const viewer of world.viewers) {
    const mine = world.entities.filter((e) => e.viewer === viewer.key);
    if (viewer.role === 'size') {
      // Size viewers: one notification per document, minute apart, with
      // every 7th sharing a timestamp with its neighbour.
      mine.forEach((entity, i) => {
        const at = new Date(now - (i - (i % 7 === 0 ? 1 : 0)) * 60_000 - 3600_000);
        statements.push(
          sqlNotifyStatement(uuidV7(at.getTime(), rng), entity, viewer.userId, world.others[0].userId, at, rng)
        );
      });
      continue;
    }
    for (const entity of mine) {
      const count = rng.weighted([
        [0, 2],
        [1, 4],
        [2, 2],
        [4, 1],
      ] as const);
      for (let k = 0; k < count; k++) {
        const at = rng.weighted<Date>([
          [tie, 2],
          [new Date(now - rng.int(1, 60) * 60_000), 3],
          [new Date(now - rng.int(1, 30) * 86_400_000), 3],
          [new Date(now - rng.int(60, 400) * 86_400_000), 1],
        ]);
        const state = rng.weighted([
          ['unseen', 5],
          ['seen', 3],
          ['done', 2],
        ] as const);
        statements.push(
          sqlNotifyStatement(uuidV7(at.getTime(), rng), entity, viewer.userId, sender(world, entity), at, rng, state)
        );
      }
    }
  }
  for (let i = 0; i < statements.length; i += 2000) {
    const file = join(options.outDir, `${world.scenario}.notify.${i}.sql`);
    writeFileSync(file, `BEGIN;\n${statements.slice(i, i + 2000).join('')}COMMIT;\n`);
    await execFileSql(stack, file);
  }
  options.log(`seed ${options.seed}: ${world.entities.length} entities, ${statements.length} notifications`);
  return { world, users };
}

export function sender(world: World, entity: Entity): string {
  const owner = entity.owner === entity.viewer ? 'b' : entity.owner;
  return world.others.find((o) => o.key === owner)?.userId ?? world.others[0].userId;
}

async function signInAll(stack: Stack, world: World): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (const viewer of world.viewers) users.set(viewer.key, await signIn(stack, viewer.key, viewer.email));
  for (const other of world.others) users.set(other.key, await signIn(stack, other.key, other.email));
  return users;
}
