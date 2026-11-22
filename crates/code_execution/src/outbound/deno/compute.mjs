// Trusted bootstrap of an ExecuteCode module: TypeScript (module.ts) in its
// own Deno process with no network (`--deny-net`), no token, no SDK in its
// import map and no files but its own. The run's JS tools program reads it
// with `get(name)` and `call(name, ...args)`; the runner relays each as one
// line on stdin and this answers with one reply frame on stdout. Values cross
// as copied JSON, at most `maxValueBytes` each.
const write = Deno.stdout.writeSync.bind(Deno.stdout);
const inspect = Deno.inspect.bind(Deno);
const stringify = JSON.stringify.bind(JSON);
const parse = JSON.parse.bind(JSON);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hasOwn = Object.hasOwn;
function emit(frame) {
  const bytes = encoder.encode(`${stringify(frame)}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += write(bytes.subarray(offset));
}
const consoleMethod = (level) => (...args) => emit({
  type: "log", level,
  message: `module: ${args.map(value => typeof value === "string" ? value : inspect(value, {colors: false, depth: 4, customInspect: false})).join(" ")}`,
});
globalThis.console = {
  log: consoleMethod("info"), info: consoleMethod("info"),
  debug: consoleMethod("debug"), warn: consoleMethod("warn"), error: consoleMethod("error"),
};
// As in a TypeScript program: sleeping burns the run's deadline, and a
// worker would bring fresh timers.
const sleepBanned = (name) => function () {
  throw new Error(`${name} is unavailable in an ExecuteCode module: it computes and returns; the run's deadline covers it.`);
};
for (const name of ["setTimeout", "setInterval", "setImmediate", "Worker"]) globalThis[name] = sleepBanned(name);
AbortSignal.timeout = sleepBanned("AbortSignal.timeout");
Atomics.wait = sleepBanned("Atomics.wait");
Atomics.waitAsync = sleepBanned("Atomics.waitAsync");

// stdin, one line at a time: the context, then one request per line.
const reader = Deno.stdin.readable.getReader();
let buffered = "";
async function nextLine() {
  for (;;) {
    const end = buffered.indexOf("\n");
    if (end >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      return line;
    }
    const {value, done} = await reader.read();
    if (done) return undefined;
    buffered += decoder.decode(value, {stream: true});
  }
}

// A value as the JS tools program receives it: copied JSON, within the cap.
function copy(what, value, maxValueBytes) {
  if (typeof value === "function") {
    // A copy would drop it silently.
    throw new Error(`${what} is a function: call it with call(...) instead of get(...).`);
  }
  let text;
  try {
    text = stringify(value === undefined ? null : value);
  } catch (error) {
    throw new Error(`${what} can't be copied as JSON: ${error?.message ?? error}`);
  }
  const bytes = encoder.encode(text).length;
  if (bytes > maxValueBytes) {
    throw new Error(`${what} is ${bytes} bytes as JSON; at most ${maxValueBytes} bytes cross between source and module at a time.`);
  }
  return parse(text);
}

const {maxValueBytes} = parse(await nextLine() ?? "{}");
// The module loads once, before the first request: its top-level code and
// `export const` values run here. A module that fails to load answers every
// request with why.
let exports;
let loadError;
try {
  exports = await import(new URL("./module.ts", import.meta.url).href);
} catch (error) {
  loadError = `the module failed to load: ${String(error)}`;
}
for (;;) {
  const line = await nextLine();
  if (line === undefined) break;
  const {id, op, name, args} = parse(line);
  try {
    if (loadError) throw new Error(loadError);
    if (typeof name !== "string" || !hasOwn(exports, name)) {
      const names = Object.keys(exports).join(", ") || "nothing";
      throw new Error(`the module exports no ${stringify(name)}; it exports ${names}.`);
    }
    const exported = exports[name];
    let value;
    if (op === "call") {
      if (typeof exported !== "function") throw new Error(`${name} is not a function: read it with get(${stringify(name)}).`);
      value = copy(`What ${name} returned`, await exported(...(args ?? [])), maxValueBytes);
    } else {
      value = copy(name, await exported, maxValueBytes);
    }
    emit({type: "reply", id, value});
  } catch (error) {
    emit({type: "reply", id, error: String(error?.message ?? error)});
  }
}
Deno.exit(0);
