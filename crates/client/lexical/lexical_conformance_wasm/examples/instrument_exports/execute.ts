const received: number[] = [];
const { instance } = await WebAssembly.instantiate(await Bun.stdin.bytes(), {
  env: {
    foreign(value: number) {
      received.push(value);
      if (value === -1) throw new Error('import trap');
      return [value + 1, 4321n];
    },
  },
});
const exports = instance.exports as {
  __lexical_record_export_entry(bytes: number): void;
  counter: WebAssembly.Global;
  bytes: WebAssembly.Global;
  pair(value: number): [number, bigint];
  imported(value: number): [number, bigint];
  alias(value: number): [number, bigint];
  outer(value: number): [number, bigint];
  trap(): void;
  ordinaryFree(pointer: number, flag: number): void;
  __wbg_test_free(pointer: number, flag: number): void;
};
const initial = exports.counter.value;
const pair = exports.pair(7).map(String);
const counts = [exports.counter.value];
const alias = exports.alias(8).map(String);
counts.push(exports.counter.value);
const outer = exports.outer(9).map(String);
counts.push(exports.counter.value);
const imported = exports.imported(41).map(String);
counts.push(exports.counter.value);
let importedTrapped = false;
try {
  exports.imported(-1);
} catch (error) {
  importedTrapped = error instanceof Error && error.message === 'import trap';
}
counts.push(exports.counter.value);
let trapped = false;
try {
  exports.trap();
} catch (error) {
  trapped = error instanceof WebAssembly.RuntimeError;
}
counts.push(exports.counter.value);
exports.ordinaryFree(0, 0);
counts.push(exports.counter.value);
const freeBytes = [exports.bytes.value];
exports.__wbg_test_free(0, 0);
counts.push(exports.counter.value);
freeBytes.push(exports.bytes.value);
exports.__wbg_test_free(0, 0);
counts.push(exports.counter.value);
freeBytes.push(exports.bytes.value);
exports.__lexical_record_export_entry(0);
counts.push(exports.counter.value);
console.log(JSON.stringify({
  initial,
  pair: [Number(pair[0]), pair[1]],
  alias: [Number(alias[0]), alias[1]],
  outer: [Number(outer[0]), outer[1]],
  imported: [Number(imported[0]), imported[1]],
  importedTrapped,
  received,
  counts,
  bytes: exports.bytes.value,
  freeBytes,
  trapped,
  helperPresent: '__lexical_record_export_entry' in exports,
}));
