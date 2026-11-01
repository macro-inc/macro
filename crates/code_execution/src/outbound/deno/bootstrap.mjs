import { Macro, gateRequests, observeRequests } from "@macro-inc/sdk";

// Trusted bootstrap: credentials arrive once on stdin, then user code is imported
// dynamically so module reads are checked against the scratch-only read grant.
const write = Deno.stdout.writeSync.bind(Deno.stdout);
const exit = Deno.exit.bind(Deno);
const inspect = Deno.inspect.bind(Deno);
const stringify = JSON.stringify.bind(JSON);
const parse = JSON.parse.bind(JSON);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isArray = Array.isArray;
const entries = Object.entries;
const hasOwn = Object.hasOwn;
function emit(frame) {
  const bytes = encoder.encode(`${stringify(frame)}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += write(bytes.subarray(offset));
}
function cut(text, bytes) {
  const encoded = encoder.encode(text);
  return encoded.length <= bytes ? text : decoder.decode(encoded.subarray(0, bytes));
}
function outline(value, depth) {
  if (value === null) return "null";
  if (isArray(value)) {
    if (value.length === 0) return "[]";
    return `Array(${value.length}) of ${depth < 4 ? outline(value[0], depth + 1) : "..."}`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth >= 4) return "{...}";
  const fields = entries(value);
  const shown = fields.slice(0, 20).map(([key, field]) => `${key}: ${outline(field, depth + 1)}`);
  if (fields.length > 20) shown.push(`...${fields.length - 20} more`);
  return `{${shown.join(", ")}}`;
}
// The result is read by a model: an oversized `data` becomes its outline and
// the start of its JSON instead of failing the whole run.
function resultFrame(value, limitBytes) {
  const text = stringify(value);
  const bytes = encoder.encode(text).length;
  if (bytes <= limitBytes) return {type: "result", value};
  // Outline the JSON form, so handles appear as what they serialize to.
  const json = parse(text);
  const wrapped = json !== null && typeof json === "object" && !isArray(json) && hasOwn(json, "data");
  const data = wrapped ? json.data : json;
  const summary = {
    truncated: true, bytes, limitBytes,
    outline: cut(outline(data, 0), limitBytes / 4),
    preview: cut(stringify(data) ?? "null", limitBytes / 4),
    hint: `The result was ${bytes} bytes, over the ${limitBytes}-byte limit, so only its outline and start are returned. Return only the fields and items you need, filter in code, or use batched reads such as macro.tasks.summaries and macro.initiatives.summaries.`,
  };
  return {type: "result", value: wrapped ? {...json, data: summary} : summary, summarized_from_bytes: bytes};
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
  const {maxResultBytes, operations, unattended, ...context} = await new Response(Deno.stdin.readable).json();
  // An unattended program's writes follow its policy: a dry run answers each
  // one with an empty result, otherwise only writes to its services run.
  // Operations missing from the catalog count as writes.
  const catalog = new Map((operations ?? []).map(operation => [operation.key, operation]));
  const routes = (operations ?? []).map(operation => ({
    ...operation,
    service: operation.key.slice(0, operation.key.indexOf(".")),
    pattern: new RegExp(`${operation.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`),
  }));
  const writable = (service) =>
    unattended.writes.mode === "services" && unattended.writes.services.includes(service);
  if (unattended) gateRequests(({service, operation}) => {
    if (catalog.get(`${service}.${operation}`)?.write === false) return undefined;
    if (unattended.writes.mode === "dry_run") return {skip: {data: {}}};
    if (writable(service)) return undefined;
    return {refuse: `This routine step can't make changes in ${service}: it may only change ${unattended.writes.services.join(", ") || "nothing"}.`};
  });
  const originalFetch = globalThis.fetch.bind(globalThis);
  const origins = new Set(Object.values(context.hosts).map(host => new URL(host).origin));
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    if (request.headers.has("authorization") && origins.has(new URL(request.url).origin)) {
      for (const [name, value] of Object.entries(context.traceHeaders ?? {})) {
        if (name === "traceparent" || name === "tracestate") request.headers.set(name, value);
      }
      // Marks the request as a program's, not a person's in the app, so an API
      // can ask it to confirm what a person would have chosen by opening it.
      request.headers.set("x-macro-code-execution", "1");
      // Backstop for the write policy: an authenticated request that didn't
      // come through the gate (code holding the SDK client's credential, or
      // a route outside the catalog) is sent only if a read or an allowed
      // write matches its route.
      if (unattended && request.method !== "GET" && request.method !== "HEAD") {
        const path = new URL(request.url).pathname;
        const allowed = routes.some(route => route.method === request.method && route.pattern.test(path)
          && (!route.write || writable(route.service)));
        if (!allowed) return Promise.reject(new Error(unattended.writes.mode === "dry_run"
          ? "A dry run doesn't send changes."
          : "This routine step can't send that request."));
      }
    }
    return originalFetch(request);
  };
  const activeRequests = new Set();
  let observedRequests = 0;
  observeRequests(value => {
    // A gated operation reports once, as skipped or refused, with no start.
    if (value.status === "started" || value.status === "skipped" || value.status === "refused") {
      if (++observedRequests > 128) {
        if (observedRequests === 129) emit({type: "progress", value: {truncated: true}});
        return;
      }
      if (value.status === "started") activeRequests.add(value.id);
    } else if (!activeRequests.delete(value.id)) return;
    emit({type: "progress", value});
  });
  const macro = new Macro({token: context.token, hosts: context.hosts});
  // A literal dynamic import joins Deno's initial static graph, bypassing read
  // permissions. Compute this specifier so the entire generated graph is loaded
  // at runtime and every local module read requires the scratch permission.
  const program = new URL(unattended ? "./main.ts" : "./main.mjs", import.meta.url).href;
  if (unattended) {
    // The write policy lives in fetch; nothing else may reach the network
    // (raw sockets) or start a realm with its own fetch (workers).
    for (const name of ["connect", "connectTls", "startTls"]) Object.defineProperty(Deno, name, {value: undefined});
    globalThis.Worker = undefined;
  }
  const { main } = await import(program);
  let value;
  if (unattended) {
    if (typeof main !== "function") throw new Error("Export an async main(context: StepContext) function.");
    // Never the credential, hosts or trace context: only the SDK and the step's inputs.
    value = await main({...unattended.arguments, macro});
  } else {
    const session = context.sessionId ? macro.agentSessions.byId(context.sessionId) : undefined;
    const execution = session && context.executionId ? session.codeExecutions.byId(context.executionId) : undefined;
    if (typeof main !== "function") throw new Error("Export an async main({macro, session, execution}) function.");
    value = await main({...context, macro, session, execution});
  }
  if (unattended) {
    // A step's output feeds later steps whole; one too large fails instead
    // of being summarized.
    const bytes = encoder.encode(stringify(value ?? null) ?? "null").length;
    if (bytes > maxResultBytes) {
      emit({type: "error", message: `The step's output is ${Math.ceil(bytes / 1024)} KB as JSON; a step's output can be at most ${Math.floor(maxResultBytes / 1024)} KB. Return only what later steps need.`});
      exit(0);
    }
    emit({type: "result", value: value ?? null});
  } else {
    emit(resultFrame(value ?? null, maxResultBytes));
  }
  exit(0);
} catch (error) {
  emit({type: "error", message: String(error)});
  exit(0);
}
