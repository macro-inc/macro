/**
 * Repro (bun run repro/session-harness.ts): the PR links panel's opener
 * lookup (pr-links-query.ts, `fetchSoupEntitiesById('asf', openerIds)`), the
 * one read whose `harness` PrAgentSessionsSection.tsx shows. A fresh user
 * starts two agent sessions; then each app runs its own lookup in the page,
 * with its own modules:
 *
 * - main: `storageServiceClient.getSoupAstItems` with
 *   `compileClause(confine({ asf: or(eq(agentSessionId)) }))`, `expand: true`
 *   (pr-links-query.ts at 8f161035c06);
 * - branch: `fetchGraphqlSoupPage(soupEntitiesByIdArgs('asf', ids))`.
 *
 * Prints, per side, each returned row's tag, the keys of its data, its raw
 * `harness`, and the `harness` of `mapApiSoupItemToEntity(row)`, which is what
 * the panel reads. Fresh synthetic user; needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser } from '../lib/browser';
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const ids: string[] = [];
for (let i = 0; i < 2; i++) ids.push((await owner.post<{ session: { id: string } }>('/agent-harness/agent-sessions', {})).session.id);
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, probe, owner.browserCookies());
  const describe = `(items, map) => items.map((item) => ({
    tag: item.tag,
    dataKeys: Object.keys(item.data ?? {}).sort(),
    rawHarness: item.data?.harness ?? null,
    entityHarness: (() => { try { return map(item).harness ?? null; } catch (e) { return 'map threw: ' + String(e).slice(0, 80); } })(),
  }))`;
  const main = await s.pages.old.evaluate(async ({ ids, describe }) => {
    const { clause, compileClause, confine } = await import(/* @vite-ignore */ '/src/features/soup/filters/index.ts');
    const { storageServiceClient } = await import(/* @vite-ignore */ '/src/lib/service-clients/service-storage/client.ts');
    const { mapApiSoupItemToEntity } = await import(/* @vite-ignore */ '/src/lib/queries/soup/transform-utils.ts');
    const body = {
      ...compileClause(confine({ asf: clause.or(...ids.map((id: string) => clause.eq('agentSessionId', id))) })),
      limit: ids.length,
      expand: true,
    };
    const result = await storageServiceClient.getSoupAstItems({ params: {}, body });
    if (result.isErr()) return { error: JSON.stringify(result.error).slice(0, 300), body };
    return { body, rows: (new Function(`return ${describe}`)() as Function)(result.value.items, mapApiSoupItemToEntity) };
  }, { ids, describe });
  const branch = await s.pages.new.evaluate(async ({ ids, describe }) => {
    const { soupEntitiesByIdArgs } = await import(/* @vite-ignore */ '/src/features/block-pr/queries/pr-links-query.ts');
    const { fetchGraphqlSoupPage } = await import(/* @vite-ignore */ '/src/lib/queries/soup/graphql/fetch-page.ts');
    const { mapApiSoupItemToEntity } = await import(/* @vite-ignore */ '/src/lib/queries/soup/transform-utils.ts');
    const args = soupEntitiesByIdArgs('asf', ids);
    const page = await fetchGraphqlSoupPage(args, { requestPolicy: 'network-only' });
    return { args, rows: (new Function(`return ${describe}`)() as Function)(page.items, mapApiSoupItemToEntity) };
  }, { ids, describe });
  console.log(JSON.stringify({ sessions: ids.length, main, branch }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
