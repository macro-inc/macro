// Plays code mode's bootstrap for an OCaml program built with Code_mode,
// the way the harness runs it: no env, reads only the program and the
// prebuilt modules, network only to the stand-in API.
//   deno run --no-prompt --deny-env --deny-write --deny-run --deny-ffi --deny-sys \
//     --allow-read=<program dir>[,<assets>] --allow-net=127.0.0.1 \
//     run.mjs <main.js> <expected frame .json> [<prebuilt assets dir>]
// It serves a stand-in contacts API, sets globalThis.__macroCodeMode (the
// contract in ../code_mode.mli), wraps fetch to mark API requests, loads
// wasm_of_ocaml's loader without CommonJS or env access, and compares the
// final frame with the expected one. Prints one JSON line:
// {"frame", "main_at"}: main_at is the epoch ms at which Code_mode.run read
// its context (startup is that minus the process's spawn time).
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as tty from "node:tty";

const [loaderArg, expectedArg, assets] = Deno.args;
const loaderPath = path.resolve(loaderArg);
const expected = JSON.parse(Deno.readTextFileSync(expectedArg));

const TOKEN = "mak_good";
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, request => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/contacts") {
    if (request.headers.get("x-macro-user-api-key") === TOKEN && request.headers.get("x-macro-code-execution") === "1")
      return Response.json({ contacts: ["macro|a@example.com", "macro|b@example.com"] });
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  return new Response("not found", { status: 404 });
});
const base = `http://127.0.0.1:${server.addr.port}`;
const services = ["agent-harness", "storage", "auth", "email", "calendar", "cognition", "notification",
  "properties", "search", "scheduled-action", "static-files", "connection", "contacts", "unfurl"];
const hosts = Object.fromEntries(services.map(service => [service, base]));

// The real bootstrap's fetch wrapper, reduced: mark API requests.
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).origin === base) request.headers.set("x-macro-code-execution", "1");
  return originalFetch(request);
};

let mainAt = null;
let settle;
const finished = new Promise(resolve => { settle = resolve; });
const context = JSON.stringify({
  token: TOKEN, hosts, webAppUrl: "https://macro.com", sessionId: "session-1", executionId: "execution-1",
});
globalThis.__macroCodeMode = {
  get context() { mainAt ??= Date.now(); return context; },
  finish: frame => settle(JSON.parse(frame)),
};

// wasm_of_ocaml's loader is CommonJS-style and, since Deno defines
// globalThis.process, takes its Node path. Give it a process without env
// and a require serving only the modules it uses; library modules come
// from the prebuilt dir, the program's own from beside its loader.
const shimProcess = {
  versions: { node: "deno-shim" },
  env: Object.freeze(Object.create(null)),
  argv: ["deno", loaderPath],
  platform: "linux",
  cwd: () => path.dirname(loaderPath),
  chdir: () => { throw new Error("chdir is unavailable"); },
  exit: code => settle({ type: "error", message: `exit ${code}` }),
  on: () => {},
  cpuUsage: () => ({ user: performance.now() * 1000, system: 0 }),
};
const prebuilt = new Set(assets ? [...Deno.readDirSync(assets)].map(entry => entry.name) : []);
const modules = {
  "node:fs": fs,
  "node:fs/promises": {
    ...fsPromises,
    readFile: file => {
      const name = path.basename(file);
      return Deno.readFile(prebuilt.has(name) ? path.join(assets, name) : file);
    },
  },
  "node:path": path,
  "node:tty": tty,
};
function require(name) {
  const module = modules[name];
  if (!module) throw new Error(`${name} is unavailable`);
  return module;
}
require.main = { filename: loaderPath };
const shimGlobal = new Proxy(globalThis, {
  get: (target, key) => key === "process" ? shimProcess : Reflect.get(target, key),
});
// The loader's first statement selects the platform; return the promise
// the rest of it starts.
const source = Deno.readTextFileSync(loaderPath);
const marker = "(Object));";
const at = source.indexOf(marker);
if (at < 0) throw new Error("unexpected wasm_of_ocaml loader shape");
const loader = new Function("globalThis", "require", "process",
  `${source.slice(0, at + marker.length)}return ${source.slice(at + marker.length)}`);
try {
  await loader(shimGlobal, require, shimProcess);
} catch (error) {
  settle({ type: "error", message: `loader: ${error}` });
}

const frame = await finished;
await server.shutdown();
const canonical = value => JSON.stringify(value, (_, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
console.log(JSON.stringify({ frame, main_at: mainAt }));
if (canonical(frame) !== canonical(expected)) {
  console.error(`expected ${JSON.stringify(expected)}`);
  Deno.exit(1);
}
