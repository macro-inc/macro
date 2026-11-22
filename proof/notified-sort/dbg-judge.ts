// Prints how lib/dom-held.ts judges one recorded Home check: DBG_RUN, DBG_LANE, DBG_STEP.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heldApartFromShared, onlyStaleTimeLabels, staleMailLabels } from './lib/dom-held.ts';
const run = process.env.DBG_RUN ?? 'quiet';
for (const line of readFileSync(join(import.meta.dirname, 'out', run, 'steps.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const s = JSON.parse(line);
  if (s.lane !== process.env.DBG_LANE || String(s.step) !== process.env.DBG_STEP || !s.checks?.domRows) continue;
  const e = s.checks.domRows;
  console.log(JSON.stringify({ seq: s.seq, classes: s.checks.dom?.classes, sides: s.checks.domReload?.sides, held: heldApartFromShared(e).newHeld, labels: onlyStaleTimeLabels(e), mail: staleMailLabels(e) }));
  for (const k of ['oldMounted', 'newMounted', 'oldReload', 'newReload']) console.log(k, e[k].length, JSON.stringify(e[k].slice(0, 12)));
}
