import { Macro, gateRequests, limitSearches, observeRequests, sendVerbHeaders } from "@macro-inc/sdk";

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
// Each search is heavy for the search cluster's few threads, so a program that
// fans searches out makes every other user's search wait behind it. Four at once
// still lets a program with dozens of searches finish inside its deadline.
const SEARCHES_IN_FLIGHT = 4;
// Calls of one operation that, unfinished at the deadline, read as a loop.
const LOOP_HINT_CALLS = 50;
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
// The bootstrap keeps one timer for itself: the loop report before the deadline.
const bootstrapTimeout = globalThis.setTimeout.bind(globalThis);
const sleepBanned = (name) => function () {
  throw new Error(`${name} is unavailable in ExecuteCode: Custom timers are unsupported, including Promise.race deadline guards. The host already enforces the execution deadline (30 s by default in ExecuteCode). Use bounded batches with Promise.allSettled and return successful results with any failures before the deadline. Promise.allSettled does not add a timeout. To check back later, create a routine with macro.routines.create.`);
};
// The interpreter JS tools programs run in schedules its own work with
// timers, and gives programs none: those runs get them back.
const hostTimers = {setTimeout, setInterval, setImmediate};
for (const name of ["setTimeout", "setInterval", "setImmediate", "Worker"]) globalThis[name] = sleepBanned(name);
AbortSignal.timeout = sleepBanned("AbortSignal.timeout");
Atomics.wait = sleepBanned("Atomics.wait");
Atomics.waitAsync = sleepBanned("Atomics.waitAsync");
// A static import of a blocked built-in fails to link before unavailable.mjs
// can throw; the catch below explains it the same way.
const unavailable = new Set(entries(parse(Deno.readTextFileSync(new URL("./imports.json", import.meta.url))).imports)
  .filter(([, target]) => target === "./unavailable.mjs").map(([specifier]) => specifier));
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
async function runJsTools(context, limits, allowedOperations, callTool, module) {
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
    module,
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
  return jsToolsResult(result.value);
}
// What a JS tools program returns becomes the result's data, unless it returns
// code mode's result shape, {data, reviews?, images?}: then it is the result
// as a TypeScript program's would be, so its reviews become review cards and
// its images reach the model.
const RESULT_KEYS = new Set(["data", "reviews", "images"]);
function jsToolsResult(value) {
  const shaped = value !== null && typeof value === "object" && !isArray(value) &&
    hasOwn(value, "data") && Object.keys(value).every(key => RESULT_KEYS.has(key));
  return shaped ? value : {data: value};
}
// stdin, one line at a time: the run's context, then, for a JS tools
// program sent with a module, one reply per `get` or `call`.
const stdinReader = Deno.stdin.readable.getReader();
let stdinBuffered = "";
async function nextLine() {
  for (;;) {
    const end = stdinBuffered.indexOf("\n");
    if (end >= 0) {
      const line = stdinBuffered.slice(0, end);
      stdinBuffered = stdinBuffered.slice(end + 1);
      return line;
    }
    const {value, done} = await stdinReader.read();
    if (done) return undefined;
    stdinBuffered += decoder.decode(value, {stream: true});
  }
}
// A JS tools program's `get` and `call`: each is one frame to the runner,
// which relays it to the module's own process (no network, no SDK, no
// token) and writes its reply on stdin. Values cross as JSON copies, so
// nothing of either realm reaches the other.
function moduleBridge(module) {
  const noModule = () => Promise.reject(new Error("This ExecuteCode call sent no module: pass module, a TypeScript module whose exports get(name) reads and call(name, ...args) calls."));
  if (!module) return {get: noModule, call: noModule};
  const pending = new Map();
  let nextRequest = 0;
  (async () => {
    for (;;) {
      const line = await nextLine();
      if (line === undefined) break;
      const reply = parse(line);
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      if (!waiting) continue;
      if (typeof reply.error === "string") waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.value ?? null);
    }
    for (const waiting of pending.values()) waiting.reject(new Error("The module stopped."));
    pending.clear();
  })().catch(error => emit({type: "log", level: "warn", message: `module replies stopped: ${String(error)}`}));
  const request = (op, name, args) => {
    if (typeof name !== "string") return Promise.reject(new Error(`${op} takes the export's name as a string.`));
    const frame = args === undefined ? {type: "module", id: nextRequest + 1, op, name} : {type: "module", id: nextRequest + 1, op, name, args};
    let bytes;
    try {
      bytes = encoder.encode(stringify(frame)).length;
    } catch (error) {
      return Promise.reject(new Error(`${op}(${stringify(name)}) arguments can't be copied as JSON: ${error?.message ?? error}`));
    }
    if (bytes > module.maxValueBytes) {
      return Promise.reject(new Error(`${op}(${stringify(name)}) arguments are ${bytes} bytes as JSON; at most ${module.maxValueBytes} bytes cross between source and module at a time.`));
    }
    nextRequest += 1;
    return new Promise((resolve, reject) => {
      pending.set(frame.id, {resolve, reject});
      emit(frame);
    });
  };
  return {get: name => request("get", name), call: (name, args) => request("call", name, args)};
}
try {
  const {maxResultBytes, maxCallsPerOperation, remainingMs, operations, unattended, language, allowedOperations, jsTools, module, ...context} = parse(await nextLine() ?? "null");
  // The requests a JS tools program was checked to send (the permission
  // gate); absent, every request goes as before. Each is matched by its operation
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
  const allowed = language === "js_tools" && isArray(allowedOperations)
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
  // A program stuck in a loop (reading the same thread over and over, walking
  // every page of a search for a match that never comes) would call one API
  // until the deadline and end with only "timed out", which tells the agent
  // nothing. So the run stops, naming the operation, when one operation passes
  // its budget, or near the deadline if one has been called often enough to
  // look like a loop. Either way it stops at once, even if the program catches
  // errors: a catch-and-retry loop must not spin on to the deadline.
  const calls = new Map();
  const mostCalled = () => {
    let top = ["", 0];
    for (const entry of calls) if (entry[1] > top[1]) top = entry;
    return top;
  };
  const advice = "Calls already started, writes included, may have taken effect: check what they did before running anything again. Then rewrite the program: stop iterating once you have what you need (break out of for await loops), read each item once and reuse it, prefer list and batch reads over one read per item, or narrow the search.";
  const stop = (message) => {
    emit({type: "error", message});
    exit(0);
  };
  gateRequests(({service, operation}) => {
    const key = `${service}.${operation}`;
    const count = (calls.get(key) ?? 0) + 1;
    if (count > maxCallsPerOperation) {
      stop(`Stopped: this program called ${key} more than ${maxCallsPerOperation} times, so it is probably looping. ${advice} A job that truly needs more calls of one operation must be split into smaller jobs.`);
    }
    calls.set(key, count);
    if (dryRun && catalog.get(key)?.write !== false) return {skip: {data: {}}};
    return undefined;
  });
  if (remainingMs > 0) {
    const timer = bootstrapTimeout(() => {
      const [key, count] = mostCalled();
      if (count >= LOOP_HINT_CALLS) {
        stop(`Stopped near the deadline: this program called ${key} ${count} times and did not finish, so it may be looping, or the job is too big for one run. ${advice}`);
      }
    }, remainingMs - Math.min(1500, remainingMs / 4));
    Deno.unrefTimer(timer);
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  sendVerbHeaders(true);
  // `--allow-net` lets `host.` through as `host`, but the URL keeps the dot.
  const originOf = (url) => {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/\.$/, "");
    return parsed.origin;
  };
  const origins = new Set(Object.values(context.hosts).map(originOf));
  // A proxied run reaches only its forwarder: a request to a host's base is
  // sent to that service under the forwarder, longest base first. The
  // forwarder, not this, marks it.
  const forwarded = Object.entries(context.forwarder ?? {})
    .map(([service, local]) => [context.hosts[service].replace(/\/$/, ""), local])
    .sort(([left], [right]) => right.length - left.length);
  const sendRequest = (input, init) => {
    const request = new Request(input, init);
    // Every request to an SDK origin, whatever credential it carries.
    if (origins.has(originOf(request.url))) {
      for (const [name, value] of Object.entries(context.traceHeaders ?? {})) {
        if (name === "traceparent" || name === "tracestate") request.headers.set(name, value);
      }
      // Marks the request as a program's, not a person's in the app, so an API
      // can ask it to confirm what a person would have chosen by opening it.
      // A dialect program says so, so a refusal names its operations.
      request.headers.set("x-macro-code-execution", language === "js_tools" ? "js_tools" : "1");
      // A dry run's backstop: a request to an SDK origin that didn't come
      // through the gate is sent only if a read matches its route.
      if (dryRun && request.method !== "GET" && request.method !== "HEAD") {
        const path = new URL(request.url).pathname;
        const read = routes.some(route => route.method === request.method && route.pattern.test(path) && !route.write);
        if (!read) return Promise.reject(new Error("A dry run doesn't send changes."));
      }
    }
    for (const [base, local] of forwarded) {
      const url = request.url;
      if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) {
        return originalFetch(new Request(`${local}${url.slice(base.length)}`, request));
      }
    }
    return originalFetch(request);
  };
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
  // A JS tools call names its operation on fetch itself
  // (init.macroSdkOperation, see callTool); the TypeScript SDK reports the
  // same events and asks the same gate from inside. Ids are numbers, as the
  // TypeScript SDK's are: the host's activity reads only those.
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
  limitSearches(SEARCHES_IN_FLIGHT);
  const macro = new Macro({token: context.token, hosts: context.hosts, webAppUrl: context.webAppUrl});
  // A literal dynamic import joins Deno's initial static graph, bypassing read
  // permissions. Compute this specifier so the entire generated graph is loaded
  // at runtime and every local module read requires the scratch permission.
  const program = new URL("./main.ts", import.meta.url).href;
  // Every request must go through the fetch above, which marks it as the
  // program's and holds back a dry run's writes. Nothing else may reach the
  // network (raw sockets, listeners, websockets), start a realm with its own
  // fetch (workers), or reach Node's or Deno's internals past the import map.
  for (const name of ["connect", "connectTls", "startTls", "listen", "listenTls", "serve", "serveHttp", "upgradeWebSocket"]) {
    Object.defineProperty(Deno, name, {value: undefined});
  }
  delete Deno[Deno.internal];
  for (const name of ["WebSocket", "EventSource"]) globalThis[name] = undefined;
  // An unattended program gets no Worker at all; an attended one keeps the
  // Worker above, which throws like a timer.
  if (unattended || language === "js_tools") globalThis.Worker = undefined;
  // `node:process` exports its own getBuiltinModule, so the import map blocks
  // that module too.
  if (globalThis.process) {
    for (const name of ["getBuiltinModule", "binding"]) globalThis.process[name] = undefined;
  }
  let value;
  if (language === "js_tools") {
    // One tool call: the generated SDK method itself, not the SDK's observed
    // wrapper, so this process's fetch reports and gates it as a named
    // request. Only the method's path, query and body come from the program
    // (the runtime picks them); the credential and hosts stay in `macro`.
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
    value = await runJsTools(context, jsTools, allowedOperations, callTool, moduleBridge(module));
  } else if (unattended) {
    const { main } = await import(program);
    if (typeof main !== "function") throw new Error("Export an async main(context: StepContext) function.");
    // Never the credential, hosts or trace context: only the SDK and the step's inputs.
    const args = {...unattended.arguments, macro};
    // A routine's entity knob arrives as its item marked `$entity`; code gets
    // the SDK's handle for it, never the id. One call per kind, as
    // routine_program's `EntityKind::factory` names it.
    if (args.knobs) {
      const handles = {
        channel: (id) => macro.channels.byId(id),
        document: (id) => macro.documents.byId(id),
        project: (id) => macro.projects.byId(id),
        database: (id) => macro.databases.byId(id),
        user: (id) => macro.users.byId(id),
        task: (id) => macro.tasks.byId(id),
        email_thread: (id) => macro.email.byId(id),
        chat: (id) => macro.chats.byId(id),
        crm_company: (id) => macro.crm.companyById(id),
        crm_contact: (id) => macro.crm.contactById(id),
        initiative: (id) => macro.initiatives.byId(id),
      };
      args.knobs = Object.fromEntries(Object.entries(args.knobs).map(([name, knob]) => {
        const item = knob?.$entity;
        if (!item) return [name, knob];
        const handle = Object.hasOwn(handles, item.type) ? handles[item.type] : undefined;
        if (!handle) throw new Error(`Knob ${name} names a ${item.type}, which code can't use.`);
        return [name, handle(item.id)];
      }));
    }
    value = await main(args);
  } else {
    const { main } = await import(program);
    const session = context.sessionId ? macro.agentSessions.byId(context.sessionId) : undefined;
    const execution = session && context.executionId ? session.codeExecutions.byId(context.executionId) : undefined;
    if (typeof main !== "function") throw new Error("Export an async main(context: CodeContext) function.");
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
  if (error instanceof ProgramRefused) {
    emit({type: "error", message: error.message, failure: "compile"});
    exit(0);
  }
  if (error instanceof ProgramTimedOut) {
    emit({type: "error", message: error.message, failure: "timed_out"});
    exit(0);
  }
  const link = /^SyntaxError: The requested module '([^']+)' does not provide an export named/.exec(String(error));
  const message = link && unavailable.has(link[1])
    ? `Error: ${link[1]} is unavailable in ExecuteCode. Make requests with fetch or the macro SDK.`
    : String(error);
  emit({type: "error", message});
  exit(0);
}
