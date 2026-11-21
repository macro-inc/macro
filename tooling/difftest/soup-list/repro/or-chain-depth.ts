/**
 * Repro (bun run repro/or-chain-depth.ts): main's PR links query
 * (apps/web/src/features/block-pr/queries/pr-links-query.ts, fetchSoupEntitiesById
 * at 8f161035c06) asks REST Soup for linked documents by id with
 * clause.or(...ids), which AST.or (features/soup/filters/facets/clause.ts:39-43)
 * folds into a right-leaning chain: two JSON levels per id. This posts that
 * shape to REST Soup for growing id counts and prints the status and body.
 * GraphQL Soup gets the same filter balanced (the branch's path).
 */
import { ApiUser } from '../lib/api';
const origin = process.argv[2] ?? 'https://localhost:23209';
const owner = await new ApiUser(origin, `owner@wrepro-${Date.now().toString(36)}.difftest.dev`).login();
const chain = (n: number) => {
  const lits = Array.from({ length: n }, () => ({ l: { id: crypto.randomUUID() } }));
  return lits.reduceRight((acc: unknown, ast) => ({ '|': [ast, acc] }));
};
for (const n of [1, 50, 62, 63, 64, 65, 80, 94]) {
  const body = JSON.stringify({ df: chain(n), limit: n, expand: true });
  const r = await owner.raw('/dss/items/soup/ast', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  console.log(`${String(n).padStart(3)} ids: HTTP ${r.status} ${(await r.text()).replace(/(\.\|\[1\])+/, '.|[1]…').slice(0, 200)}`);
}
