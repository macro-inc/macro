const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
const { instance } = await WebAssembly.instantiate(bytes);
const wasm = instance.exports as {
  memory: WebAssembly.Memory;
  counter: WebAssembly.Global;
  bytes: WebAssembly.Global;
  input(pointer: number, length: number): void;
  optional(pointer: number, length: number): void;
};
const result = [];
for (const text of ['abc', 'é', '😀', 'e\u0301', '\ud800', '']) {
  const encoded = new TextEncoder().encode(text);
  new Uint8Array(wasm.memory.buffer).set(encoded, 16);
  wasm.input(16, encoded.length);
  result.push(Number(wasm.bytes.value));
}
wasm.optional(0, 123);
result.push(Number(wasm.bytes.value));
wasm.input(0, 3);
result.push(Number(wasm.bytes.value));
let trapped = false;
try {
  wasm.input(65535, 2);
} catch (error) {
  if (!(error instanceof WebAssembly.RuntimeError)) throw error;
  trapped = true;
}
process.stdout.write(
  JSON.stringify({
    result,
    counter: wasm.counter.value,
    bytes: Number(wasm.bytes.value),
    distinct: wasm.input !== wasm.optional,
    trapped,
  })
);
