// Runs test_fetch (wasm_of_ocaml output) under Deno against a stand-in API.
//   deno run --allow-read --allow-net=127.0.0.1 --allow-env run.mjs <test_fetch.bc.wasm.js> <sdk dir>
// It plays code mode's bootstrap: it wraps globalThis.fetch, reads each
// call's init.macroSdkOperation, refuses kinds.putTree, skips kinds.upload
// in a dry run, adds a verb header, and records what reached the server.
// `<sdk dir>` is packages/sdk: specs and generated TypeScript method names
// for the sdk_method check.
import { createRequire } from "node:module";
import * as path from "node:path";

const [program, sdk] = Deno.args;

// What the stand-in server received, newest last. Bodies are byte strings
// (one char per byte), which OCaml reads back exactly.
const log = [];
const bytes = buffer => {
  let text = "";
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return text;
};
const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
  const url = new URL(request.url);
  const body = await request.arrayBuffer();
  log.push({
    method: request.method,
    target: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
    body: bytes(body),
  });
  const json = (value, status) => Response.json(value, { status });
  switch (url.pathname) {
    case "/base/profiles/ada": return json({ name: "Ada", bio: null }, 200);
    case "/base/profiles/nobody": return json({ message: "no such profile" }, 404);
    case "/base/profiles/broken": return new Response("not json", { status: 200 });
    case "/base/profiles": return new Response(body, { status: 201, headers: { "content-type": "application/json" } });
    case "/base/ping": return new Response(null, { status: 204 });
    case "/base/upload": return new Response(null, { status: 204 });
    case "/base/attach": return new Response("stored", { status: 200 });
    case "/base/files/binary": return new Response(binary, { status: 200, headers: { "content-type": "application/pdf" } });
    default: return new Response("unexpected", { status: 500 });
  }
});

// A port nothing listens on.
const closed = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const closedPort = closed.addr.port;
closed.close();

// The bootstrap's side of the contract (macro_sdk_fetch.mli).
const operations = [];
const operationIds = [];
const verbs = { "kinds.getProfile": "read", "kinds.createProfile": "created" };
const originalFetch = globalThis.fetch.bind(globalThis);
const test = {
  base: `http://127.0.0.1:${server.addr.port}/base`,
  closed: `http://127.0.0.1:${closedPort}`,
  dryRun: false,
  requests: () => log.length,
  last: () => log.at(-1),
  operation: () => operations.at(-1),
  operationId: () => operationIds.at(-1),
  names: [],
  finish: failures => {
    server.shutdown().then(() => Deno.exit(failures === 0 ? 0 : 1));
  },
};
globalThis.fetch = (input, init) => {
  const operation = init?.macroSdkOperation;
  operations.push(operation ? `${operation.service}.${operation.operation}` : "none");
  operationIds.push(operation ? `${operation.service}.${operation.operationId}` : "none");
  const key = operation && `${operation.service}.${operation.operation}`;
  if (key === "kinds.putTree") return Promise.reject(new Error("refused by the gate"));
  if (key === "kinds.upload" && test.dryRun) return Promise.resolve(new Response(null, { status: 204 }));
  const request = new Request(input, init);
  if (verbs[key]) request.headers.set("x-macro-sdk-verb", verbs[key]);
  return originalFetch(request);
};

// Every operationId with the method names its service's TypeScript SDK has.
for (const entry of Deno.readDirSync(path.join(sdk, "specs"))) {
  if (!entry.name.endsWith(".json")) continue;
  const service = entry.name.slice(0, -".json".length);
  let source;
  try {
    source = Deno.readTextFileSync(path.join(sdk, "generated", service, "sdk.gen.ts"));
  } catch {
    continue; // A spec the TypeScript SDK does not wrap.
  }
  const methods = [...source.matchAll(/public (\w+)<ThrowOnError/g)].map(match => match[1]);
  const spec = JSON.parse(Deno.readTextFileSync(path.join(sdk, "specs", entry.name)));
  for (const item of Object.values(spec.paths ?? {}))
    for (const operation of Object.values(item))
      if (operation?.operationId) test.names.push([service, operation.operationId, methods]);
}

globalThis.macroSdkFetchTest = test;
// wasm_of_ocaml's loader is a CommonJS script that finds its .assets
// directory through require.main, which Deno leaves unset: run it as one
// with a require that has it. It starts the program and returns.
const file = path.resolve(program);
const require = createRequire(file);
require.main = { filename: file };
new Function("require", "module", "exports", Deno.readTextFileSync(file))(require, {}, {});
