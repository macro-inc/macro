// The endpoint coverage check. Run with `just coverage`.
//
// Every generated SDK method must be either called somewhere under src/
// ("wrapped") or hand-listed in ./skipped.ts. Wrapped methods need one verb.
// Four steps, nothing clever:
//   1. read every endpoint method name out of generated/<service>/sdk.gen.ts
//   2. an endpoint is wrapped if the text `.storage.getDocument(` (etc.)
//      appears anywhere under src/
//   3. fail if an endpoint is in neither list — or in both (a skipped
//      endpoint that gained a call site must be removed from skipped.ts)
//   4. fail if a wrapped method has no verb or a verb has no wrapped method

import { join } from 'node:path';
import { services } from '../../services';
import { sdkVerbs } from '../utils/verbs';
import * as skipped from './skipped';

const ROOT = join(import.meta.dir, '..', '..');

// How each service is reached from MacroClient (client.storage, client.email,
// ...). A service that is not wired into MacroClient cannot be wrapped.
const ACCESSORS: Partial<Record<(typeof services)[number], string>> = {
  'agent-harness': 'agentHarness',
  'scheduled-action': 'scheduledAction',
  unfurl: 'unfurl',
  auth: 'auth',
  calendar: 'calendar',
  cognition: 'cognition',
  contacts: 'contacts',
  email: 'email',
  notification: 'notification',
  properties: 'properties',
  search: 'search',
  storage: 'storage',
};

// 'scheduled-action' -> 'scheduledAction'
function camel(service: string): string {
  return service.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

// step 2 input: all hand-written source as one big string (minus this folder,
// so the skip list itself doesn't count as a call site)
let src = '';

for await (const path of new Bun.Glob('src/**/*.ts').scan(ROOT)) {
  if (path.startsWith('src/coverage/')) continue;
  src += await Bun.file(join(ROOT, path)).text();
}

let failed = false;
const wrappedMethods = new Set<string>();

for (const service of services) {
  // step 1: endpoint methods are the `public foo<...>` declarations
  const sdkSource = await Bun.file(
    join(ROOT, 'generated', service, 'sdk.gen.ts'),
  ).text();
  const endpoints = [...sdkSource.matchAll(/^\s*public (\w+)</gm)]
    .map((m) => m[1])
    .sort();

  const accessor = ACCESSORS[service];
  const lists = skipped as Record<string, readonly string[]>;
  const skipList = new Set<string>([
    ...lists[`${camel(service)}Excluded`],
    ...lists[`${camel(service)}Backlog`],
  ]);

  for (const endpoint of endpoints) {
    // step 2: does src/ call it?
    const wrapped =
      accessor !== undefined && src.includes(`.${accessor}.${endpoint}(`);
    const key = `${service}.${endpoint}`;
    if (wrapped) wrappedMethods.add(key);

    // step 3
    if (!wrapped && !skipList.has(endpoint)) {
      console.error(
        `UNCOVERED  ${service}.${endpoint}: wrap it in an entity/namespace, or add it to src/coverage/skipped.ts`,
      );
      failed = true;
    }
    if (wrapped && skipList.has(endpoint)) {
      console.error(
        `STALE SKIP ${service}.${endpoint}: it has a call site now; remove it from src/coverage/skipped.ts`,
      );
      failed = true;
    }
    if (wrapped && !sdkVerbs[key]) {
      console.error(`MISSING VERB ${key}: add it to src/utils/verbs.ts`);
      failed = true;
    }
  }
}

for (const key of Object.keys(sdkVerbs)) {
  if (!wrappedMethods.has(key)) {
    console.error(`STALE VERB ${key}: no wrapped generated SDK method exists`);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log('endpoint coverage OK');
