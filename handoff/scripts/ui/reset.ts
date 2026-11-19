// Puts the subr stack's eval workspace back between recording tries: deletes the
// owner's routines (parents after their copies), restores task statuses, and
// trashes documents and databases the seed didn't make, with the bench's own reset.
// nix develop --command bun reset.ts   (env BENCH=<checkout>/crates/scheduled_action/bench)
import { SQL } from 'bun';

const bench = process.env.BENCH ?? '$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions/crates/scheduled_action/bench';
const { reset } = await import(`${bench}/runcheck.ts`);
const { stack, login } = await import(`${bench}/stack.ts`);
const { SEEDED_IDS, savedDatabases } = await import(`${bench}/setup.ts`);
const { DATABASES, OWNER, PERSON_KEYS, email } = await import(`${bench}/workspace.ts`);

const instance = 'subr';
const at = stack(instance, process.env.TEMPO_URL ?? 'http://localhost:3200');
const ids = { ...SEEDED_IDS, ...(savedDatabases(instance) ?? {}) };
const tokens: Record<string, string> = {};
for (const person of PERSON_KEYS) tokens[person] = await login(at, email(person));
const db = new SQL(at.postgres);
await reset(at, db, tokens, new Set(DATABASES.map((name: string) => ids[name])));
const left = await db`select count(*)::int as n from scheduled_action`;
console.log(`reset done; routines left on the stack: ${left[0].n}`);
await db.close();
