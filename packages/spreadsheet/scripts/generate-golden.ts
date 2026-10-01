import { AutomergeDoc } from '@macro-inc/automerge';

const doc = new AutomergeDoc();
doc.getMap('spreadsheetMeta').set('formatVersion', 1);
doc.commit();
await Bun.write(
  new URL('../../../static_assets/spreadsheet-golden.2.bin', import.meta.url),
  doc.export({ mode: 'snapshot' })
);
doc.free();
