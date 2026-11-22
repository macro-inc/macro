/**
 * The PR changes the `soup.rest_fallback` reason to fixed text: main names the
 * rejected value or literal key ("calendar event literal ea"), the branch does
 * not ("calendar event literal with an unknown key"). `suite-fuzz.ts` compares
 * against main's reason, so each such case fails as `translator-verdict` and
 * `span-attributes`. This checks that every one of them is that change and
 * nothing else: main's reason maps to the branch's, and the span's shape and
 * kind equal the expected ones. Prints counts and every unexplained failure.
 *
 *   bun run fixed-reasons.ts results/quiet.json results/load.json ...
 */
const VALUE_SUFFIXED = ['unknown file association', 'unsupported document subType', 'unsupported channelType', 'email attachment kind', 'unsupported shared email filter', 'notification state', 'call status', 'unsupported pull request status', 'unsupported pull request review status', 'property entity type', 'email view'];
const LITERAL_KINDS = ['calendar event', 'document', 'project', 'initiative', 'chat', 'email', 'channel thread', 'channel', 'call', 'crm company', 'crm contact', 'foreign entity', 'github pull request'];
export function fixedReason(old: string): string {
  for (const p of VALUE_SUFFIXED) if (old.startsWith(p + ' ')) return p;
  if (old.startsWith('agent session literal ')) return 'unsupported agent session literal';
  if (old.startsWith('CRM association ')) return 'CRM association with an unknown key';
  for (const k of LITERAL_KINDS) if (old.startsWith(`${k} literal `)) return `${k} literal with an unknown key`;
  return old;
}
const failuresOf = (r: any) => Object.values(r.fuzz ?? {}).flatMap((x: any) => x.failures ?? []);
for (const path of process.argv.slice(2)) {
  const r = await Bun.file(path).json();
  const fs = failuresOf(r);
  let verdictOk = 0, spanOk = 0; const bad: string[] = []; const mapped: Record<string, number> = {};
  for (const f of fs) {
    if (f.kind === 'translator-verdict') {
      const m = /^main says (.*), branch says (.*)$/.exec(f.detail);
      const main = m && JSON.parse(m[1]); const branch = m && JSON.parse(m[2]);
      if (main != null && branch != null && fixedReason(main) === branch && main !== branch) { verdictOk++; mapped[`${main.split(' ').slice(0, -1).join(' ')} … → ${branch}`] = (mapped[`${main.split(' ').slice(0, -1).join(' ')} … → ${branch}`] ?? 0) + 1; }
      else bad.push(f.detail);
    } else if (f.kind === 'span-attributes') {
      const m = /^span (\{.*\}); expected reason (.*), shape (.*), kind (\w+)$/.exec(f.detail);
      const a = m && JSON.parse(m[1]);
      if (a && a['soup.fallback.reason'] === fixedReason(m[2]) && a['soup.fallback.shape'] === m[3] && a['soup.fallback.kind'] === m[4]) spanOk++;
      else bad.push(f.detail.slice(0, 400));
    }
  }
  const other: Record<string, number> = {};
  for (const f of fs) if (f.kind !== 'translator-verdict' && f.kind !== 'span-attributes') other[f.kind] = (other[f.kind] ?? 0) + 1;
  console.log(JSON.stringify({ path: path.split('/').pop(), verdictOk, spanOk, unexplained: bad.length, other, mapped }, null, 1));
  for (const b of bad) console.log('  UNEXPLAINED', b);
}
