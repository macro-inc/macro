// Seeding the eval's workspace onto a stack, and the setup the seed CLI can't
// do: due dates relative to today, and databases.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Stack, call, login, sdk } from './stack';
import { DATABASES, FIXTURE, OWNER, SCENARIO_NAME, email, scenario, tasks } from './workspace';

const CACHE = join(homedir(), '.cache/routines-eval');
const REPO = resolve(import.meta.dir, '../../..');

/** The seed CLI's id for a scenario entity (`derive_id` in tooling/seed_cli). */
export function seedId(scenarioName: string, kind: string, key: string): string {
  const bytes = Buffer.alloc(16);
  bytes[0] = 0x5e;
  bytes[1] = 0xed;
  createHash('sha256').update(scenarioName).digest().copy(bytes, 2, 0, 2);
  createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(scenarioName),
        Buffer.from([0]),
        Buffer.from(kind),
        Buffer.from([0]),
        Buffer.from(key),
      ]),
    )
    .digest()
    .copy(bytes, 4, 0, 12);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Seeded ids by the name a request uses. */
export const SEEDED_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(FIXTURE).map(([name, { kind, key }]) => [name, seedId(SCENARIO_NAME, kind, key)]),
);

/** Write the scenario and apply it with the seed CLI. Applying again resets it. */
export function seed(instance: string) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${SCENARIO_NAME}.json`);
  writeFileSync(path, `${JSON.stringify(scenario(), null, 1)}\n`);
  const result = Bun.spawnSync(['just', 'seed-scenario', '--instance', instance, 'apply', '--file', path], {
    cwd: REPO,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) throw new Error(`seed-scenario exited with ${result.exitCode}`);
}

// Property ids of the system task properties (crates/system_properties).
const STATUS = '00000001-0000-0000-0000-000000000002';
const DUE = '00000001-0000-0000-0000-000000000004';

/** Status option ids, by the seed's status names (system_properties' StatusOption). */
export const STATUS_OPTIONS: Record<string, string> = {
  not_started: '00000001-0000-0000-0002-000000000001',
  in_progress: '00000001-0000-0000-0002-000000000002',
  in_review: '00000001-0000-0000-0002-000000000003',
  completed: '00000001-0000-0000-0002-000000000004',
  canceled: '00000001-0000-0000-0002-000000000005',
};

export async function setTaskStatus(at: Stack, token: string, taskId: string, status: string) {
  await call(`${at.storage}/properties/entities/DOCUMENT/${taskId}/${STATUS}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ value: { type: 'select_option', option_id: STATUS_OPTIONS[status] } }),
  });
}

/** Noon on the day `days` from `now`, in `timezone`, as an instant. */
function noon(now: Date, days: number, timezone: string): string {
  const day = new Date(now.getTime() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: timezone });
  // Noon UTC is within the same calendar day in every US time zone.
  return `${day}T17:00:00.000Z`;
}

type SetupState = { day: string; databases: Record<string, string> };

const statePath = (instance: string) => join(CACHE, `${instance}.${SCENARIO_NAME}.setup.json`);

/**
 * Due dates relative to today and the databases requests name. Due dates are
 * set again when the day changed since the last setup, so "due today" stays
 * true; databases are created once.
 */
export async function setup(at: Stack, timezone: string, force = false): Promise<Record<string, string>> {
  const path = statePath(at.instance);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const saved: SetupState | undefined = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  const token = await login(at, email(OWNER));
  const macro = sdk(at, token);
  const databases: Record<string, string> = {};
  const existing = await macro.databases.list();
  for (const name of DATABASES) {
    // The one made before wins: a draft may have made another of the same name.
    let found = existing.find((database) => database.id === saved?.databases[name])?.id;
    for (const database of existing) {
      if (!found && (await database.name()) === name) found = database.id;
    }
    databases[name] = found ?? (await macro.databases.create({ name })).id;
  }
  if (force || saved?.day !== today) {
    const now = new Date();
    let set = 0;
    for (const [key, task] of Object.entries(tasks())) {
      if (task.due === undefined) continue;
      await call(`${at.storage}/properties/entities/DOCUMENT/${seedId(SCENARIO_NAME, 'task', key)}/${DUE}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ value: { type: 'date', value: noon(now, task.due, timezone) } }),
      });
      set++;
    }
    console.log(`set ${set} due dates for ${today}`);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ day: today, databases } satisfies SetupState, null, 2)}\n`);
  return { ...SEEDED_IDS, ...databases };
}
