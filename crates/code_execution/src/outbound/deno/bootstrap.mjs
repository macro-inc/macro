import { Macro, gateRequests, observeRequests, sendVerbHeaders } from "@macro-inc/sdk";

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
// Sleeping to wait for something burns the execution deadline and blocks the
// turn. A worker would bring fresh timers; imports of node timer modules are
// remapped to timers.mjs.
// A function, not an arrow, so `new Worker(...)` reaches the throw.
const sleepBanned = (name) => function () {
  throw new Error(`${name} is unavailable in ExecuteCode: do not sleep or poll in a program. Finish this execution, and to check back later create a routine with macro.routines.create.`);
};
// The interpreter JS tools programs run in schedules its own work with
// timers, and gives programs none: those runs get them back.
const hostTimers = {setTimeout, setInterval, setImmediate};
for (const name of ["setTimeout", "setInterval", "setImmediate", "Worker"]) globalThis[name] = sleepBanned(name);
AbortSignal.timeout = sleepBanned("AbortSignal.timeout");
Atomics.wait = sleepBanned("Atomics.wait");
Atomics.waitAsync = sleepBanned("Atomics.waitAsync");
// The token an unattended OCaml program's client holds instead of the run's:
// the program never sees the credential, and fetch swaps this one for it.
const UNATTENDED_TOKEN = "code-mode-unattended";
// Runs a compiled OCaml program (main.js, wasm_of_ocaml's loader, beside its
// own modules in main.assets/) and resolves to its final frame, the JSON
// text Code_mode.run hands to finish(). The loader is CommonJS-style and,
// since Deno defines globalThis.process, takes its Node path: it gets a
// process without env, a require serving only the Node modules it reads
// files with, and a node:fs/promises whose readFile serves the prebuilt
// library modules from `assets`, so reads stay inside scratch and that
// directory. Its stdout and stderr writes become log frames.
async function runOcaml(context, assets) {
  if (typeof WebAssembly.Suspending !== "function" || typeof WebAssembly.promising !== "function") {
    throw new Error("OCaml programs need JSPI (WebAssembly.Suspending and WebAssembly.promising), which this Deno lacks.");
  }
  // Loaded here, not at the top, so JavaScript runs don't load them.
  const [nodeFs, nodeFsPromises, nodePath, nodeTty] = await Promise.all(
    ["node:fs", "node:fs/promises", "node:path", "node:tty"].map(name => import(name)));
  const loaderPath = new URL("./main.js", import.meta.url).pathname;
  const directory = nodePath.dirname(loaderPath);
  let frame;
  let exited;
  globalThis.__macroCodeMode = {
    context: stringify(context),
    finish: text => { frame ??= text; },
  };
  const pending = {1: "", 2: ""};
  // One streaming decoder per stream, so a character a buffer flush splits
  // is decoded whole.
  const decoders = {1: new TextDecoder(), 2: new TextDecoder()};
  const flush = (fd, all) => {
    if (all) pending[fd] += decoders[fd].decode();
    const lines = pending[fd].split("\n");
    pending[fd] = all ? "" : lines.pop();
    for (const line of lines) if (!all || line !== "") emit({type: "log", level: fd === 1 ? "info" : "warn", message: line});
  };
  const fs = {
    ...nodeFs,
    writeSync(fd, buffer, offset, length, position) {
      if (fd !== 1 && fd !== 2) return nodeFs.writeSync(fd, buffer, offset, length, position);
      const bytes = typeof buffer === "string" ? encoder.encode(buffer) : buffer.subarray(offset ?? 0, (offset ?? 0) + (length ?? buffer.length));
      pending[fd] += decoders[fd].decode(bytes, {stream: true});
      flush(fd, false);
      return bytes.length;
    },
  };
  const prebuilt = new Set([...Deno.readDirSync(assets)].map(entry => entry.name));
  const modules = {
    "node:fs": fs,
    "node:fs/promises": {
      ...nodeFsPromises,
      readFile: file => {
        const name = nodePath.basename(String(file));
        return Deno.readFile(prebuilt.has(name) ? nodePath.join(assets, name) : file);
      },
    },
    "node:path": nodePath,
    "node:tty": nodeTty,
  };
  const require = name => {
    if (!hasOwn(modules, name)) throw new Error(`${name} is unavailable in ExecuteCode`);
    return modules[name];
  };
  require.main = {filename: loaderPath};
  const process = {
    versions: {node: "deno"},
    env: Object.freeze(Object.create(null)),
    argv: ["deno", loaderPath],
    platform: "linux",
    cwd: () => directory,
    chdir: () => { throw new Error("chdir is unavailable in ExecuteCode"); },
    // Node's exit never returns; this one stops the program by throwing.
    exit: code => {
      exited ??= code;
      throw new Error(`exit ${code}`);
    },
    on: () => {},
    cpuUsage: () => ({user: performance.now() * 1000, system: 0}),
  };
  const shimGlobal = new Proxy(globalThis, {
    get: (target, key) => key === "process" ? process : Reflect.get(target, key),
  });
  // The loader's first statement sets up globalThis; the rest is one
  // expression that starts the program and returns its promise. Pinned by
  // the OCaml tests: a wasm_of_ocaml upgrade that changes this shape fails
  // with this message.
  const source = Deno.readTextFileSync(loaderPath);
  const marker = "(Object));";
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("unexpected wasm_of_ocaml loader shape");
  const loader = new Function("globalThis", "require", "process",
    `${source.slice(0, at + marker.length)}return ${source.slice(at + marker.length)}`);
  try {
    await loader(shimGlobal, require, process);
  } catch (error) {
    // Exiting after Code_mode.run has finished is the normal end.
    if (exited === undefined) throw error;
  }
  flush(1, true);
  flush(2, true);
  if (frame === undefined) {
    throw new Error(exited === undefined
      ? "The program ended without calling Code_mode.run."
      : `The program exited with status ${exited} before Code_mode.run finished.`);
  }
  return parse(frame);
}
// A JS tools program refused before it ran: it doesn't parse, or the
// analysis can't see everything it may call. Reported like a compile error.
class ProgramRefused extends Error {}
// A JS tools program the interpreter stopped at its deadline, which it keeps
// a little before the run's, so its logs still arrive.
class ProgramTimedOut extends Error {}
// Where in main.js a diagnostic is, as `main.js:<line>:<column>: ` (both
// 1-based); `location.column` is 0-based.
const at = location => location ? `main.js:${location.line}:${location.column + 1}: ` : "main.js: ";
// Runs a JS tools program (main.js) in @opencode/codemode's interpreter
// (js-tools.mjs), which has no fetch, no Deno and no imports: its only way
// out is a tool call, and `callTool` sends it. The program is analyzed
// first with the same bundle the permission gate analyzed it with, and only
// the operations found may run (the interpreter's tool.before hook), and
// `allowedOperations`, the ones the gate checked it to call, must cover them
// all. A run without them never starts (DenoRunner refuses it first).
async function runJsTools(context, limits, allowedOperations, callTool) {
  if (!isArray(allowedOperations)) {
    throw new Error("JS tools programs run only with the operations they were checked to call");
  }
  const jsTools = await import(new URL("./js-tools.mjs", import.meta.url).href);
  const catalog = parse(Deno.readTextFileSync(new URL("./js-tools.json", import.meta.url)));
  const source = Deno.readTextFileSync(new URL("./main.js", import.meta.url));
  const analysis = jsTools.analyze(source, jsTools.toolsByPath(catalog));
  if (analysis.status === "diagnostics") {
    throw new ProgramRefused(analysis.diagnostics.map(diagnostic => `${at(diagnostic.location)}${diagnostic.message}`).join("\n"));
  }
  if (analysis.status !== "ok") {
    throw new ProgramRefused(analysis.reasons.map(reason => `${at(reason.location)}${reason.message}`).join("\n"));
  }
  const unchecked = analysis.operations.filter(found => !allowedOperations.some(call =>
    call.service === found.service && call.operationId === found.operation &&
    call.method === found.method && call.route === found.route));
  if (unchecked.length > 0) {
    throw new ProgramRefused(`${at()}the program calls ${unchecked.map(found => `tools.${found.path}`).join(", ")}, which it wasn't checked to call; it changed after it was checked.`);
  }
  const runtime = jsTools.makeRuntime({
    catalog,
    admitted: new Set(analysis.operations.map(found => found.path)),
    call: callTool,
    limits,
  });
  const result = await runtime.execute(source, {
    context: {sessionId: context.sessionId ?? null, executionId: context.executionId ?? null, webAppUrl: context.webAppUrl},
  });
  // The interpreter bounds its logs' text, not their frames: JSON escaping
  // can make a line up to six times longer, so a line over a frame is cut
  // to what fits escaped.
  const fitted = message => {
    const frame = encoder.encode(stringify({type: "log", level: "info", message})).length;
    return frame <= limits.maxOutputBytes ? message : message.slice(0, Math.floor((limits.maxOutputBytes - 64) / 6));
  };
  for (const message of result.logs ?? []) emit({type: "log", level: "info", message: fitted(message)});
  for (const warning of result.warnings ?? []) emit({type: "log", level: "warn", message: fitted(warning.message)});
  if (!result.ok) {
    const {kind, message} = result.error;
    if (kind === "ParseError" || kind === "UnsupportedSyntax") throw new ProgramRefused(`${at(result.error.location && {line: result.error.location.line, column: result.error.location.column - 1})}${message}`);
    if (kind === "TimeoutExceeded") throw new ProgramTimedOut(message);
    throw new Error(`${kind}: ${message}`);
  }
  return {data: result.value};
}
try {
  const {maxResultBytes, operations, unattended, language, ocamlAssets, allowedOperations, jsTools, ...context} = await new Response(Deno.stdin.readable).json();
  // The requests an OCaml program was checked to send (the permission gate);
  // absent, every request goes as before. Each is matched by its operation
  // and by where it goes: method, the service's host and the route. A
  // parameter could carry a sibling route's literal segment
  // (`/documents/{}` with `system_skills`), which the server routes to that
  // sibling: a request a more specific rival route also matches is refused.
  const escape = text => text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const target = (service, route) => {
    const host = new URL(context.hosts[service] ?? "http://invalid.invalid");
    const template = `${host.pathname.replace(/\/$/, "")}${route}`;
    return {
      origin: host.origin,
      segments: template.split("/"),
      pattern: new RegExp(`^${String(template).split("{}").map(escape).join("[^/]+")}$`),
    };
  };
  // Whether a route with `rival`'s segments wins over `own`'s for a path both
  // match: at the first segment where one has a literal and the other a
  // parameter, the literal wins, as the services' routers rank them.
  const outranks = (rival, own) => {
    for (let i = 0; i < own.length; i++) {
      if (rival[i] === own[i]) continue;
      if (own[i] === "{}") return true;
      if (rival[i] === "{}") return false;
    }
    return false;
  };
  const allowed = (language === "ocaml" || language === "js_tools") && isArray(allowedOperations)
    ? allowedOperations.map(call => ({
      ...call,
      ...target(call.service, String(call.route)),
      rivals: (call.rivals ?? []).map(rival => target(rival.service, String(rival.route))),
    }))
    : null;
  // Checks the request exactly as it will be sent.
  const admitted = (operation, request) => {
    if (!operation) return false;
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    return allowed.some(call =>
      call.service === operation.service && call.operationId === operation.operationId &&
      call.method === method && call.origin === url.origin && call.pattern.test(url.pathname) &&
      !call.rivals.some(rival =>
        rival.origin === url.origin && rival.pattern.test(url.pathname) &&
        outranks(rival.segments, call.segments)));
  };
  // A dry run answers each write with an empty result, so it shows what the
  // program would do. Operations missing from the catalog count as writes.
  const dryRun = unattended?.dryRun === true;
  const catalog = new Map((operations ?? []).map(operation => [operation.key, operation]));
  const routes = (operations ?? []).map(operation => ({
    ...operation,
    pattern: new RegExp(`${operation.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`),
  }));
  if (dryRun) gateRequests(({service, operation}) =>
    catalog.get(`${service}.${operation}`)?.write === false ? undefined : {skip: {data: {}}});
  const originalFetch = globalThis.fetch.bind(globalThis);
  sendVerbHeaders(true);
  const origins = new Set(Object.values(context.hosts).map(host => new URL(host).origin));
  // Requests SDK calls make, by id, so a completion reports only those started.
  const activeRequests = new Set();
  let observedRequests = 0;
  const observe = value => {
    // A gated operation reports once, as skipped or refused, with no start.
    if (value.status === "started" || value.status === "skipped" || value.status === "refused") {
      if (++observedRequests > 128) {
        if (observedRequests === 129) emit({type: "progress", value: {truncated: true}});
        return;
      }
      if (value.status === "started") activeRequests.add(value.id);
    } else if (!activeRequests.delete(value.id)) return;
    emit({type: "progress", value});
  };
  observeRequests(observe);
  const sendRequest = (input, init) => {
    const request = new Request(input, init);
    if (request.headers.has("authorization") && origins.has(new URL(request.url).origin)) {
      if (language === "ocaml" && unattended) request.headers.set("authorization", `Bearer ${context.token}`);
      for (const [name, value] of Object.entries(context.traceHeaders ?? {})) {
        if (name === "traceparent" || name === "tracestate") request.headers.set(name, value);
      }
      // Marks the request as a program's, not a person's in the app, so an API
      // can ask it to confirm what a person would have chosen by opening it.
      request.headers.set("x-macro-code-execution", "1");
      // A dry run's backstop: an authenticated request that didn't come
      // through the gate is sent only if a read matches its route.
      if (dryRun && request.method !== "GET" && request.method !== "HEAD") {
        const path = new URL(request.url).pathname;
        const read = routes.some(route => route.method === request.method && route.pattern.test(path) && !route.write);
        if (!read) return Promise.reject(new Error("A dry run doesn't send changes."));
      }
    }
    return originalFetch(request);
  };
  // The OCaml SDK and a JS tools call name each call's operation on fetch
  // itself (init.macroSdkOperation, see packages/sdk-ocaml/fetch and
  // callTool); the TypeScript SDK reports the same events and asks the same
  // gate from inside. Ids are numbers, as the TypeScript SDK's are: the
  // host's activity reads only those.
  let nextNamedRequest = 0;
  globalThis.fetch = async (input, init) => {
    const operation = init?.macroSdkOperation;
    // The gate's backstop: a request outside what the program was checked
    // to call is never sent, nor one that doesn't say what it calls.
    if (allowed) {
      // One Request, checked and sent: nothing about it can change between.
      const request = new Request(input, init);
      input = request;
      init = {macroSdkOperation: operation};
      if (!admitted(operation, request)) {
        const service = String(operation?.service ?? "unknown");
        const operationId = String(operation?.operationId ?? "unknown");
        if (operation) observe({id: ++nextNamedRequest, service, operation: String(operation.operation), status: "refused"});
        throw new Error(`${service}.${operationId} is outside what this program was checked to call; it was not sent.`);
      }
    }
    if (!language || !operation) return sendRequest(input, init);
    const event = {id: ++nextNamedRequest, service: String(operation.service), operation: String(operation.operation)};
    if (dryRun && catalog.get(`${event.service}.${event.operation}`)?.write !== false) {
      observe({...event, status: "skipped"});
      return Response.json({});
    }
    observe({...event, status: "started"});
    try {
      const response = await sendRequest(input, init);
      observe({...event, status: response.ok ? "completed" : "failed"});
      return response;
    } catch (error) {
      observe({...event, status: "failed"});
      throw error;
    }
  };
  const macro = new Macro({token: context.token, hosts: context.hosts, webAppUrl: context.webAppUrl});
  // A literal dynamic import joins Deno's initial static graph, bypassing read
  // permissions. Compute this specifier so the entire generated graph is loaded
  // at runtime and every local module read requires the scratch permission.
  const program = new URL(unattended ? "./main.ts" : "./main.mjs", import.meta.url).href;
  if (unattended || language === "js_tools") {
    // A dry run's and the permission gate's backstop lives in fetch; nothing
    // else may reach the network (raw sockets) or start a realm with its
    // own fetch (workers).
    for (const name of ["connect", "connectTls", "startTls"]) Object.defineProperty(Deno, name, {value: undefined});
    globalThis.Worker = undefined;
  }
  let value;
  if (language === "ocaml") {
    // Never the credential for an unattended program: fetch swaps it in.
    const frame = await runOcaml({
      token: unattended ? UNATTENDED_TOKEN : context.token,
      hosts: context.hosts,
      webAppUrl: context.webAppUrl,
      sessionId: unattended ? null : context.sessionId,
      executionId: unattended ? null : context.executionId,
    }, ocamlAssets);
    if (frame.type !== "result") throw new Error(String(frame.message));
    value = frame.value;
  } else if (language === "js_tools") {
    // One tool call: the generated SDK method itself, not the SDK's observed
    // wrapper, so this process's fetch reports and gates it as a named
    // request, as it does OCaml's. Only the method's path, query and body
    // come from the program (the runtime picks them); the credential and
    // hosts stay in `macro`.
    const callTool = async (tool, input) => {
      const sdk = macro._client[tool.client];
      const prototype = sdk && Object.getPrototypeOf(sdk);
      if (!prototype || !hasOwn(prototype, tool.method)) throw new Error(`tools.${tool.path.join(".")} has no SDK method`);
      const operation = {service: tool.service, operation: tool.method, operationId: tool.operationId};
      const {data, error, response} = await prototype[tool.method].call(sdk, {
        ...input,
        headers: tool.verb ? {"x-macro-sdk-verb": tool.verb} : {},
        fetch: request => fetch(request, {macroSdkOperation: operation}),
      });
      // A request that never got an answer (refused here, or unreachable)
      // comes back as the Error; an error response as its parsed body.
      if (error instanceof Error) throw error;
      if (error !== undefined || !response?.ok) {
        throw new Error(`HTTP ${response?.status}: ${cut(stringify(error) ?? "", 2048)}`);
      }
      return data ?? null;
    };
    Object.assign(globalThis, hostTimers);
    value = await runJsTools(context, jsTools, allowedOperations, callTool);
  } else if (unattended) {
    const { main } = await import(program);
    if (typeof main !== "function") throw new Error("Export an async main(context: StepContext) function.");
    // Never the credential, hosts or trace context: only the SDK and the step's inputs.
    value = await main({...unattended.arguments, macro});
  } else {
    const { main } = await import(program);
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
  if (error instanceof ProgramRefused) emit({type: "error", message: error.message, failure: "compile"});
  else if (error instanceof ProgramTimedOut) emit({type: "error", message: error.message, failure: "timed_out"});
  else emit({type: "error", message: String(error)});
  exit(0);
}
