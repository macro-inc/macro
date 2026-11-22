import { OPS, rng } from './ops.mjs';
import { loadGroup, readState } from './group-state.mjs';
const group = loadGroup('l', 10);
const r = rng(7);
for (const [name, op] of Object.entries(OPS)) {
  if (op.inApp) continue;
  const state = await readState(group);
  const actorIndex = 0;
  const args = op.choose(r, state, group.viewers[actorIndex]);
  if (!args) { console.log(name, 'no target'); continue; }
  const res = await op.run(group.sessions[actorIndex], args, state);
  if (res.created) { group.known.add(res.created); group.created.add(res.created); }
  console.log(name, res.status, JSON.stringify(res.body)?.slice(0, 160), res.created ?? '');
}
