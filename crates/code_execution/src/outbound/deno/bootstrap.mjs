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
// The program runs in this realm and can rewrite any built-in, so the fetch
// wrapper and the dry-run gate below use only these copies, taken before it
// loads. This raises the bar for a program that tries to send an unmarked
// request or a dry run's write; it is not a security boundary. The rest of the
// bootstrap (frames, loop stops) still uses the live built-ins.
const uncurry = (method) => Function.prototype.call.bind(method);
const getter = (prototype, name) => uncurry(Object.getOwnPropertyDescriptor(prototype, name).get);
const NativeRequest = Request;
const NativeURL = URL;
const NativeError = Error;
const requestUrl = getter(Request.prototype, "url");
const requestMethod = getter(Request.prototype, "method");
const requestHeaders = getter(Request.prototype, "headers");
// Forwarding changes the URL, so copy RequestInit through captured getters.
// Passing the Request itself as options would read program-modified getters.
const requestInitGetters = [
  "method", "headers", "body", "redirect", "signal", "cache", "credentials",
  "integrity", "keepalive", "mode", "referrer", "referrerPolicy",
].map(name => [name, getter(Request.prototype, name)]);
const setHeader = uncurry(Headers.prototype.set);
const urlProtocol = getter(URL.prototype, "protocol");
const urlPathname = getter(URL.prototype, "pathname");
const urlHostname = getter(URL.prototype, "hostname");
const urlPort = getter(URL.prototype, "port");
const setHas = uncurry(Set.prototype.has);
const mapGet = uncurry(Map.prototype.get);
const mapSet = uncurry(Map.prototype.set);
const regExpExec = uncurry(RegExp.prototype.exec);
const endsWith = uncurry(String.prototype.endsWith);
const sliceString = uncurry(String.prototype.slice);
const startsWith = uncurry(String.prototype.startsWith);
const nativeFetch = globalThis.fetch.bind(globalThis);
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
for (const name of ["setTimeout", "setInterval", "setImmediate", "Worker"]) globalThis[name] = sleepBanned(name);
AbortSignal.timeout = sleepBanned("AbortSignal.timeout");
Atomics.wait = sleepBanned("Atomics.wait");
Atomics.waitAsync = sleepBanned("Atomics.waitAsync");
// A static import of a blocked built-in fails to link before unavailable.mjs
// can throw; the catch below explains it the same way.
const unavailable = new Set(entries(parse(Deno.readTextFileSync(new URL("./imports.json", import.meta.url))).imports)
  .filter(([, target]) => target === "./unavailable.mjs").map(([specifier]) => specifier));
try {
  const {maxResultBytes, maxCallsPerOperation, remainingMs, operations, unattended, ...context} = await new Response(Deno.stdin.readable).json();
  // A dry run answers each write with an empty result, so it shows what the
  // program would do. Operations missing from the catalog count as writes.
  const dryRun = unattended?.dryRun === true;
  const catalog = new Map((operations ?? []).map(operation => [operation.key, operation]));
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
    const count = (mapGet(calls, key) ?? 0) + 1;
    if (count > maxCallsPerOperation) {
      stop(`Stopped: this program called ${key} more than ${maxCallsPerOperation} times, so it is probably looping. ${advice} A job that truly needs more calls of one operation must be split into smaller jobs.`);
    }
    mapSet(calls, key, count);
    if (dryRun && mapGet(catalog, key)?.write !== false) return {skip: {data: {}}};
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
  sendVerbHeaders(true);
  const defaultPort = (protocol) => {
    if (protocol === "https:") return "443";
    if (protocol === "http:") return "80";
    return "";
  };
  // What `--allow-net` grants: host and port, whatever the scheme (a proxied
  // client sends `http://host:443/...` over TLS), with `host.` read as `host`.
  const destinationOf = (url) => {
    const parsed = new NativeURL(url);
    let hostname = urlHostname(parsed);
    if (endsWith(hostname, ".")) hostname = sliceString(hostname, 0, -1);
    return `${hostname}:${urlPort(parsed) || defaultPort(urlProtocol(parsed))}`;
  };
  const destinations = new Set(Object.values(context.hosts).map(destinationOf));
  // Each route as the requests to its own service's host and whole path, so
  // a write whose path merely ends like a read's (`/web/search`) isn't one.
  const routes = (operations ?? []).flatMap(operation => {
    const host = context.hosts[operation.key.slice(0, operation.key.indexOf("."))];
    if (!host) return [];
    const base = new URL(host).pathname.replace(/\/$/, "");
    const path = `${base}${operation.path}`.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+");
    return [{...operation, destination: destinationOf(host), pattern: new RegExp(`^${path}$`)}];
  });
  const traceHeaders = entries(context.traceHeaders ?? {})
    .filter(([name]) => name === "traceparent" || name === "tracestate");
  // A proxied run reaches only its forwarder, longest service base first.
  const forwarded = entries(context.forwarder ?? {})
    .map(([service, local]) => [context.hosts[service].replace(/\/$/, ""), local])
    .sort(([left], [right]) => right.length - left.length);
  // Async, so a refusal or a throw in here rejects like a failed fetch.
  globalThis.fetch = async (input, init) => {
    let request = new NativeRequest(input, init);
    // Every request to an SDK origin, whatever credential it carries.
    if (setHas(destinations, destinationOf(requestUrl(request)))) {
      const headers = requestHeaders(request);
      for (let index = 0; index < traceHeaders.length; index++) {
        setHeader(headers, traceHeaders[index][0], traceHeaders[index][1]);
      }
      // Marks the request as a program's, not a person's in the app, so an API
      // can ask it to confirm what a person would have chosen by opening it.
      setHeader(headers, "x-macro-code-execution", "1");
      // A dry run's backstop: a request to an SDK origin that didn't come
      // through the gate is sent only if a read matches its route.
      const method = requestMethod(request);
      if (dryRun && method !== "GET" && method !== "HEAD") {
        const destination = destinationOf(requestUrl(request));
        const path = urlPathname(new NativeURL(requestUrl(request)));
        let read = false;
        for (let index = 0; index < routes.length; index++) {
          const route = routes[index];
          if (route.method === method && !route.write && route.destination === destination
            && regExpExec(route.pattern, path) !== null) {
            read = true;
            break;
          }
        }
        if (!read) throw new NativeError("A dry run doesn't send changes.");
        // A redirect would resend the read's method and body somewhere else.
        // No prototype, so the program can't add options through
        // `Object.prototype` (a method, or headers without the mark).
        request = new NativeRequest(request, {__proto__: null, redirect: "error"});
      }
    }
    for (let index = 0; index < forwarded.length; index++) {
      const base = forwarded[index][0];
      const local = forwarded[index][1];
      const url = requestUrl(request);
      if (url === base || startsWith(url, `${base}/`) || startsWith(url, `${base}?`)) {
        const options = {__proto__: null};
        for (let field = 0; field < requestInitGetters.length; field++) {
          const name = requestInitGetters[field][0];
          const read = requestInitGetters[field][1];
          options[name] = read(request);
        }
        return nativeFetch(new NativeRequest(`${local}${sliceString(url, base.length)}`, options));
      }
    }
    return nativeFetch(request);
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
  // A client from `createHttpClient` can proxy a request to an API under a
  // URL the fetch above doesn't recognize.
  for (const name of ["connect", "connectTls", "startTls", "listen", "listenTls", "serve", "serveHttp", "upgradeWebSocket", "createHttpClient"]) {
    Object.defineProperty(Deno, name, {value: undefined});
  }
  delete Deno[Deno.internal];
  for (const name of ["WebSocket", "EventSource"]) globalThis[name] = undefined;
  // An unattended program gets no Worker at all; an attended one keeps the
  // Worker above, which throws like a timer.
  if (unattended) globalThis.Worker = undefined;
  // `node:process` exports its own getBuiltinModule, so the import map blocks
  // that module too.
  if (globalThis.process) {
    for (const name of ["getBuiltinModule", "binding"]) globalThis.process[name] = undefined;
  }
  const { main } = await import(program);
  let value;
  if (unattended) {
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
  const link = /^SyntaxError: The requested module '([^']+)' does not provide an export named/.exec(String(error));
  const message = link && unavailable.has(link[1])
    ? `Error: ${link[1]} is unavailable in ExecuteCode. Make requests with fetch or the macro SDK.`
    : String(error);
  emit({type: "error", message});
  exit(0);
}
