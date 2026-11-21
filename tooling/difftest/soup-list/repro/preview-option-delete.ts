/**
 * Repro (bun run repro/preview-option-delete.ts): does a list read through
 * the branch's preview projection (`ignoresNotifications`) see a team
 * property option deleted elsewhere, as the full projection does?
 * Mounts the same task list three times, main with no options, the branch
 * with none and with `ignoresNotifications`, deletes the assigned option over
 * REST (as another user's client would), and prints what each list shows for
 * the property over the next 20 s. Needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser } from '../lib/browser';
import { mount, settle } from '../lib/probe';
const stack = 'https://localhost:23209';
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser(stack, email).login();
await owner.post('/auth/team', { name: `Difftest repro ${tag}`, allow_domain_join: false });
const { documentId: task } = await owner.post<{ documentId: string }>('/dss/documents/create_task', { taskName: `Repro task ${tag}`, shareWithTeam: true });
const created = await owner.post<any>('/dss/properties/definitions', {
  display_name: `Difftest stage ${tag}`, scope: 'team',
  data_type: { type: 'select_string', multi: false, options: ['Lead', 'Trial'].map((value, display_order) => ({ value, display_order })) },
});
const def = created.definition?.id ?? created.id;
const options = (await owner.get<{ id: string }[]>(`/dss/properties/definitions/${def}/options`)).map((o) => o.id);
await owner.raw(`/dss/properties/entities/DOCUMENT/${task}/${def}`, { method: 'PUT', body: JSON.stringify({ value: { type: 'select_option', option_id: options[0] } }) });

// SORT=property sorts by the stage property, as the run's failing case did.
const args = {
  params: process.env.SORT === 'property' ? { limit: 20, sort_method: 'property', sort_property_definition_id: def } : { limit: 20, sort_method: 'updated_at' },
  body: { df: { l: { id: task } } },
};
const readers = [
  { side: 'old', key: 'main', options: {} },
  { side: 'new', key: 'branch', options: {} },
  { side: 'new', key: 'branchPreview', options: { ignoresNotifications: true } },
] as const;
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email,
    { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' }, owner.browserCookies());
  const stage = async (r: (typeof readers)[number]) => {
    const snap = await settle(s.pages[r.side], r.key, { timeoutMs: 1_000, stableMs: 0 });
    const json = JSON.stringify(snap.data);
    const at = json.indexOf(def);
    if (at < 0) return 'no stage property';
    const optionShown = options.filter((o) => json.includes(o));
    return optionShown.length ? `shows option ${optionShown.map((o) => options.indexOf(o)).join(',')}` : 'property, no option';
  };
  for (const r of readers) await mount(s.pages[r.side], r.key, 'ast', { args, options: r.options, pages: 1 });
  for (const r of readers) await settle(s.pages[r.side], r.key, { timeoutMs: 60_000 });
  console.log('before delete:', JSON.stringify(Object.fromEntries(await Promise.all(readers.map(async (r) => [r.key, await stage(r)])))));
  await owner.del(`/dss/properties/definitions/${def}/options/${options[0]}`);
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 20_000) {
    const now = JSON.stringify(Object.fromEntries(await Promise.all(readers.map(async (r) => [r.key, await stage(r)]))));
    if (now !== last) console.log(`+${Date.now() - t0} ms:`, (last = now));
    await Bun.sleep(250);
  }
  await s.context.close();
} finally {
  await closeBrowser();
}
