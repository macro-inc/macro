import { Macro, observeRequests } from "@macro-inc/sdk";

// Trusted bootstrap: credentials arrive once on stdin, then user code is imported
// dynamically so module reads are checked against the scratch-only read grant.
const write = Deno.stdout.writeSync.bind(Deno.stdout);
const exit = Deno.exit.bind(Deno);
const inspect = Deno.inspect.bind(Deno);
const stringify = JSON.stringify.bind(JSON);
const encoder = new TextEncoder();
function emit(frame) {
  const bytes = encoder.encode(`${stringify(frame)}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += write(bytes.subarray(offset));
}
const consoleMethod = (level) => (...args) => emit({
  type: "log", level,
  message: args.map(value => typeof value === "string" ? value : inspect(value, {colors: false, depth: 4, customInspect: false})).join(" "),
});
// Node-compatible SDK dependencies lazily attach stream properties to console.
// Keep this object extensible; all emitted frames remain untrusted and bounded.
globalThis.console = {
  log: consoleMethod("info"), info: consoleMethod("info"),
  debug: consoleMethod("debug"), warn: consoleMethod("warn"), error: consoleMethod("error"),
};
try {
  const context = await new Response(Deno.stdin.readable).json();
  const originalFetch = globalThis.fetch.bind(globalThis);
  const origins = new Set(Object.values(context.hosts).map(host => new URL(host).origin));
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    if (request.headers.has("authorization") && origins.has(new URL(request.url).origin)) {
      for (const [name, value] of Object.entries(context.traceHeaders ?? {})) {
        if (name === "traceparent" || name === "tracestate") request.headers.set(name, value);
      }
    }
    return originalFetch(request);
  };
  const activeRequests = new Set();
  let observedRequests = 0;
  observeRequests(value => {
    if (value.status === "started") {
      if (++observedRequests > 128) {
        if (observedRequests === 129) emit({type: "progress", value: {truncated: true}});
        return;
      }
      activeRequests.add(value.id);
    } else if (!activeRequests.delete(value.id)) return;
    emit({type: "progress", value});
  });
  const macro = new Macro({token: context.token, hosts: context.hosts});
  const session = context.sessionId ? macro.agentSessions.byId(context.sessionId) : undefined;
  const execution = session && context.executionId ? session.codeExecutions.byId(context.executionId) : undefined;
  // A literal dynamic import joins Deno's initial static graph, bypassing read
  // permissions. Compute this specifier so the entire generated graph is loaded
  // at runtime and every local module read requires the scratch permission.
  const program = new URL("./main.mjs", import.meta.url).href;
  const { main } = await import(program);
  if (typeof main !== "function") throw new Error("Export an async main({macro, session, execution}) function.");
  const value = await main({...context, macro, session, execution});
  emit({type: "result", value: value ?? null});
  exit(0);
} catch (error) {
  emit({type: "error", message: String(error)});
  exit(0);
}
