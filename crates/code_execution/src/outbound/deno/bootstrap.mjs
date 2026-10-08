// This is the only executable entrypoint in Deno's initial module graph.
// Generated JavaScript arrives as data on stdin; never import the snippet file.
const encode = new TextEncoder().encode.bind(new TextEncoder());
const stringify = JSON.stringify.bind(JSON);
const parse = JSON.parse.bind(JSON);
const write = Deno.stdout.writeSync.bind(Deno.stdout);
const exit = Deno.exit.bind(Deno);
const inspect = Deno.inspect.bind(Deno);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const pending = new Map();
let nextId = 1;

function emit(frame) {
  const bytes = encode(`${stringify(frame)}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += write(bytes.subarray(offset));
}

const reader = Deno.stdin.readable.getReader();
const decoder = new TextDecoder();
let buffer = "";
async function readLine() {
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      return line;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("Host connection closed");
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 1024 * 1024) throw new Error("Host frame too large");
  }
}

const host = Object.freeze({
  call(method, args = null) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        emit({ type: "call", id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  },
});
const progress = (value) => emit({ type: "progress", value });
// SDK discovery and authorization live on the trusted host. This proxy only
// spells sdk.ToolName(args) as the private call protocol; it grants no access.
const sdk = new Proxy(Object.create(null), {
  get(_target, name) {
    if (typeof name !== "string" || name === "then") return undefined;
    return (args = {}) => host.call(name, args);
  },
});
const consoleMethod = (level) => (...args) =>
  emit({
    type: "log",
    level,
    message: args.map((value) =>
      typeof value === "string"
        ? value
        : inspect(value, { colors: false, depth: 4, customInspect: false })
    ).join(" "),
  });
globalThis.console = Object.freeze({
  log: consoleMethod("info"),
  info: consoleMethod("info"),
  debug: consoleMethod("debug"),
  warn: consoleMethod("warn"),
  error: consoleMethod("error"),
});

try {
  const { source } = parse(await readLine());
  // Run the response pump independently so Promise.all can have several calls
  // in flight. A reply resolves only the promise with the matching call ID.
  const pump = async () => {
    while (true) {
      const { id, result } = parse(await readLine());
      const entry = pending.get(id);
      if (!entry) throw new Error("Unexpected host reply");
      pending.delete(id);
      if (result.status === "ok") entry.resolve(result.value);
      else entry.reject(new Error(result.message));
    }
  };
  void pump().catch((error) => {
    emit({ type: "error", message: String(error) });
    exit(0);
  });
  const value = await new AsyncFunction(
    "host",
    "progress",
    "sdk",
    `${source}\nreturn await __code_mode();`,
  )(host, progress, sdk);
  if (pending.size > 0) {
    throw new Error("Await all host calls before returning");
  }
  emit({ type: "result", value: value ?? null });
  exit(0);
} catch (error) {
  emit({ type: "error", message: String(error) });
  exit(0);
}
