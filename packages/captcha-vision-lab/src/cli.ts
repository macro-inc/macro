/**
 * `bun run lab:smoke -- --lab-run [--family <name>|all] [--provider mock|kimi]
 * ...`: the only way to run the lab. It starts the lab service on its
 * registered loopback origin, runs a few fresh challenges of each asked
 * family, writes one JSON record per challenge and exits non-zero if any
 * challenge did not reach a server-scored outcome.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FAMILY_NAMES, type FamilyName } from './families.ts';
import {
  kimiPlanner,
  mockPlanner,
  type Planner,
  type PlannerInput,
} from './planner.ts';
import { FIREWORKS_BASE_URL, KIMI_MODEL, LAB_URL } from './registry.ts';
import { runChallenge } from './run.ts';
import { createLab, serveLab } from './server.ts';

/** Per family, per run. */
const MAX_CHALLENGES = 10;

const { values } = parseArgs({
  options: {
    'lab-run': { type: 'boolean', default: false },
    family: { type: 'string', default: 'relation' },
    provider: { type: 'string', default: 'mock' },
    'mock-choice': { type: 'string', default: 'A' },
    'kimi-base-url': { type: 'string', default: FIREWORKS_BASE_URL },
    'allow-remote-provider': { type: 'boolean', default: false },
    challenges: { type: 'string', default: '1' },
    'records-dir': { type: 'string', default: 'lab-records' },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

if (!values['lab-run']) {
  fail('refusing to run: pass --lab-run to run the CAPTCHA vision lab');
}

const challenges = Number(values.challenges);
if (
  !Number.isInteger(challenges) ||
  challenges < 1 ||
  challenges > MAX_CHALLENGES
) {
  fail(`--challenges must be 1 to ${MAX_CHALLENGES}`);
}

const isFamily = (name: string): name is FamilyName =>
  FAMILY_NAMES.some((family) => family === name);

const familiesFor = (name: string): readonly FamilyName[] => {
  if (name === 'all') return FAMILY_NAMES;
  if (isFamily(name)) return [name];
  return fail(`--family must be all or one of ${FAMILY_NAMES.join(', ')}`);
};

const families = familiesFor(values.family);

/**
 * The mock answers blindly: the given label (or the first) for a choice,
 * the labels as shown for an order, zeros for text.
 */
const mockDecision = ({ response }: PlannerInput) => {
  if (response.kind === 'text') {
    return { kind: 'text' as const, text: '00000' };
  }
  if (response.kind === 'order') {
    return { kind: 'order' as const, labels: response.labels };
  }
  const wanted = values['mock-choice'];
  const label = response.labels.includes(wanted) ? wanted : response.labels[0]!;
  return { kind: 'choice' as const, label };
};

const loopback = (baseUrl: string): boolean => {
  const host = new URL(baseUrl).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
};

const plannerFor = (provider: string): Planner => {
  if (provider === 'mock') {
    return mockPlanner(mockDecision);
  }
  if (provider !== 'kimi') return fail(`unknown --provider ${provider}`);

  // A paid provider call needs its own explicit flag; the stand-in does not.
  const baseUrl = values['kimi-base-url'];
  const remote = !loopback(baseUrl);
  if (remote && !values['allow-remote-provider']) {
    return fail(
      `${baseUrl} is not loopback: pass --allow-remote-provider for a paid provider call`
    );
  }
  if (!remote) {
    // The real key never goes to a local process.
    return kimiPlanner({ baseUrl, apiKey: 'stand-in', model: KIMI_MODEL });
  }
  // The key only ever goes to Fireworks itself.
  if (baseUrl !== FIREWORKS_BASE_URL) {
    return fail(`a remote --kimi-base-url must be ${FIREWORKS_BASE_URL}`);
  }
  const apiKey = process.env.FIREWORK_API_KEY ?? '';
  if (apiKey === '') return fail('FIREWORK_API_KEY is not set');
  return kimiPlanner({ baseUrl, apiKey, model: KIMI_MODEL });
};

const planner = plannerFor(values.provider);
const recordsDir = values['records-dir'];
mkdirSync(recordsDir, { recursive: true });

const lab = createLab();
const server = serveLab(lab.fetch);
let unscored = 0;
try {
  const runs = families.flatMap((family) =>
    Array.from({ length: challenges }, () => family)
  );
  for (const family of runs) {
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue(family, sessionNonce);
    const record = await runChallenge({
      lab,
      planner,
      family,
      runId: issued.runId,
      challengeId: issued.challengeId,
      capabilityId: issued.capabilityId,
      capability: issued.capability,
      sessionNonce,
      targetUrl: LAB_URL,
      executablePath: process.env.LAB_CHROMIUM_PATH,
    });

    const file = join(recordsDir, `${record.runId}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(
      `${record.outcome}\tplanner_calls=${record.plannerCalls}\tactions=${record.actions.length}` +
        `\tplanner_ms=${record.timings.plannerMs ?? '-'}\ttokens=${record.usage?.totalTokens ?? '-'}` +
        `\tfamily=${family}\t${file}`
    );
    if (record.outcome !== 'solved' && record.outcome !== 'incorrect') {
      unscored += 1;
    }
  }
} finally {
  await server.stop(true);
}
process.exit(unscored === 0 ? 0 : 1);
