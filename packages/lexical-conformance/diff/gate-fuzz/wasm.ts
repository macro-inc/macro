// Strict actual-WASM replay of the freshly generated service oracle.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { buildWasm, root } from '../build-wasm';
buildWasm();
const wasm = createRequire(import.meta.url)('../../pkg/node/lexical_conformance_wasm.js');
const ledger = new Map(JSON.parse(readFileSync(root + '/crates/client/lexical/macro_document_model/tests/corpus/gate-divergences.json', 'utf8')).map(entry => [entry.index, entry]));
const rows = readFileSync(root + '/target/lexical-conformance/gate-oracle.jsonl', 'utf8').trimEnd().split('\n');
let divergences = 0;
for (const line of rows) {
  const row = JSON.parse(line);
  const observed = JSON.parse(wasm.gate_compare(JSON.stringify(row.before), JSON.stringify(row.after)));
  const entry = ledger.get(row.index);
  if (entry) {
    if (createHash('sha256').update(line).digest('hex') !== entry.oracleSha256 || observed.error !== entry.error || !isDeepStrictEqual(observed.actual, {throws: true}) || row.expected.commentOnly !== entry.sourceCommentOnly || isDeepStrictEqual(observed.actual, row.expected)) throw new Error(`Exact fail-closed divergence changed: ${row.index}`);
    ledger.delete(row.index); divergences++;
  } else if (!isDeepStrictEqual(observed.actual, row.expected)) {
    throw new Error(`WASM gate mismatch: ${row.index}\n${JSON.stringify(observed)}`);
  }
}
if (ledger.size || rows.length !== 20000) throw new Error('Incomplete oracle or stale ledger');
console.log(`Actual WASM: ${rows.length} strict gate comparisons, ${divergences} exact fail-closed divergences`);
const loroRows = readFileSync(root + '/target/lexical-conformance/gate-loro.jsonl', 'utf8').trimEnd().split('\n');
for (const line of loroRows) {
  const row = JSON.parse(line);
  const observed = JSON.parse(wasm.gate_compare(JSON.stringify(row.before), JSON.stringify(row.after)));
  if (!isDeepStrictEqual(observed.actual, row.expected)) throw new Error(`WASM Loro gate mismatch: ${row.index}`);
}
if (loroRows.length !== 2048) throw new Error('Incomplete Loro operation oracle');
console.log(`Actual WASM: ${loroRows.length} real Loro update pairs, zero differences`);
