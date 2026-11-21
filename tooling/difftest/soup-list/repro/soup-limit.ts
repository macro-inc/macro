/**
 * Repro (bun run repro/soup-limit.ts): main's PR-links reader asks REST Soup
 * for exactly its ids with `limit: ids.length` (pr-links-query.ts:99-110 on
 * main); the branch asks GraphQL Soup the same. What each answers past 100.
 */
import { ApiUser } from '../lib/api';
const origin = process.argv[2] ?? 'https://localhost:23209';
const tag = Date.now().toString(36);
const owner = await new ApiUser(origin, `owner@wrepro-${tag}.difftest.dev`).login();
const ids: string[] = [];
for (let i = 0; i < 130; i++)
  ids.push((await owner.post<{ documentId: string }>('/dss/documents/create_task', { taskName: `Limit ${i}` })).documentId);
const Q = `query Soup($input: SoupInput!) { user { id soup(input: $input) { nextCursor items { __typename id } } } }`;
for (const n of [100, 101, 130]) {
  const some = ids.slice(0, n);
  const body = { df: { '|': some.map((id) => ({ l: { id } })) }, limit: n, expand: true };
  const r = await owner.raw('/dss/items/soup/ast', { method: 'POST', body: JSON.stringify(body) });
  const rest = r.ok ? `${(await r.json()).items.length} rows` : `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
  let gql: string;
  try {
    const g = await owner.graphql<any>(Q, { input: { initial: { limit: n, filters: { documentFilter: { or: some.map((id) => ({ id: { eq: id } })) } } } } });
    gql = `${g.user.soup.items.length} rows, nextCursor ${g.user.soup.nextCursor ? 'set' : 'null'}`;
  } catch (e) {
    gql = String(e).slice(0, 200);
  }
  console.log(`${n} ids: REST ${rest} | GraphQL ${gql}`);
}
