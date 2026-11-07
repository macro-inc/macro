// Execute the real mirror; do not duplicate its diff/container implementation here.
import { LoroDoc, isContainer } from 'loro-crdt';
import { Mirror } from '../../../../../../../packages/loro-mirror/src/index';
import { MARKDOWN_LORO_SCHEMA } from '../../../../../../../packages/lexical-core/markdown-loro-schema';

function observe(doc: LoroDoc) {
  const kinds: Record<string, string> = {};
  function visit(value: any, path: string) {
    if (!isContainer(value)) return;
    kinds[path] = value.kind();
    if (value.kind() === 'Map') {
      for (const [key, item] of value.entries()) visit(item, `${path}/${key}`);
    } else if (value.kind() === 'List' || value.kind() === 'MovableList') {
      for (let i = 0; i < value.length; i++) visit(value.get(i), `${path}/${i}`);
    }
  }
  visit(doc.getMap('root'), 'root');
  return { value: doc.toJSON(), kinds };
}
const input = await Bun.stdin.json();
const runs = input.runs.map((run: any) => {
  const doc = new LoroDoc();
  doc.setPeerId('17');
  doc.setRecordTimestamp(false);
  if (run.snapshot) doc.import(Uint8Array.from(run.snapshot));
  const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
  const observations = [];
  for (const state of run.states) {
    mirror.setState(state);
    observations.push(observe(doc));
  }
  if (run.updates) {
    for (const bytes of run.updates) doc.import(Uint8Array.from(bytes));
    observations.push(observe(doc));
  }
  const snapshot = [...doc.export({ mode: 'snapshot' })];
  mirror.dispose();
  return { observations, snapshot };
});
console.log(JSON.stringify(runs));
