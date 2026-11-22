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
// The program runs in this realm and can rewrite any built-in, Deno's own
// fetch internals included (they read prototype accessors and plain objects'
// inherited fields), so nothing here sends a request. fetcher.mjs does, in a
// worker started before the program loads: its realm is one the program never
// reaches, and it marks each request, holds back a dry run's writes and picks
// the forwarder itself. This realm only reads the program's request into plain
// data for it, with copies of the built-ins taken now; a program that rewrites
// them changes only what its own request says, never whether it is checked.
const uncurry = (method) => Function.prototype.call.bind(method);
const getter = (prototype, name) => uncurry(Object.getOwnPropertyDescriptor(prototype, name).get);
const NativeRequest = Request;
const NativeResponse = Response;
const NativeWorker = Worker;
const NativeError = Error;
const NativeTypeError = TypeError;
const NativeDOMException = DOMException;
const denoErrors = {__proto__: null, ...Deno.errors};
const NativePromise = Promise;
const defineProperty = Object.defineProperty;
const requestUrl = getter(Request.prototype, "url");
const requestMethod = getter(Request.prototype, "method");
const requestHeaders = getter(Request.prototype, "headers");
const requestSignal = getter(Request.prototype, "signal");
const requestBody = getter(Request.prototype, "body");
const requestArrayBuffer = uncurry(Request.prototype.arrayBuffer);
// Request options the worker's fetch takes, besides method, headers and body.
const requestOptions = ["redirect", "cache", "credentials", "integrity", "keepalive", "mode", "referrer", "referrerPolicy"]
  .map(name => [name, getter(Request.prototype, name)]);
const headersForEach = uncurry(Headers.prototype.forEach);
const appendHeader = uncurry(Headers.prototype.append);
const responseHeaders = getter(Response.prototype, "headers");
const responseClone = uncurry(Response.prototype.clone);
const NativeTransformStream = TransformStream;
const relayReadable = getter(TransformStream.prototype, "readable");
const relayWritable = getter(TransformStream.prototype, "writable");
const pipeTo = uncurry(ReadableStream.prototype.pipeTo);
const cancelStream = uncurry(ReadableStream.prototype.cancel);
const promiseCatch = uncurry(Promise.prototype.catch);
const signalAborted = getter(AbortSignal.prototype, "aborted");
const signalReason = getter(AbortSignal.prototype, "reason");
const addEventListener = uncurry(EventTarget.prototype.addEventListener);
const NativeMessageChannel = MessageChannel;
const postMessage = uncurry(MessagePort.prototype.postMessage);
const mapGet = uncurry(Map.prototype.get);
const mapSet = uncurry(Map.prototype.set);
const mapDelete = uncurry(Map.prototype.delete);
const mapForEach = uncurry(Map.prototype.forEach);
const mapClear = uncurry(Map.prototype.clear);
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
  // Requests and answers go over a channel, not the worker's own messages:
  // Deno's loop for those stops for good once the program rewrites
  // `Function.prototype.call` while one is awaited.
  const {port1: fetcher, port2} = new NativeMessageChannel();
  // The worker takes its first message as the run's settings and ignores any
  // later one, and this is posted before the program loads.
  const sender = new NativeWorker(new URL("./fetcher.mjs", import.meta.url), {type: "module"});
  // The program may get hold of this worker (its events go through
  // `EventTarget.prototype.dispatchEvent`), but never the class: a worker it
  // started would have a realm of its own, with Deno's fetch unmarked. The
  // program's `Worker` is the timer refusal above, or nothing.
  for (const prototype of [NativeWorker.prototype, MessagePort.prototype]) {
    Object.defineProperty(prototype, "constructor", {value: undefined, writable: false, configurable: false});
  }
  sender.postMessage({
    port: port2, hosts: context.hosts, operations: operations ?? [], dryRun,
    traceHeaders: context.traceHeaders ?? {}, forwarder: context.forwarder ?? {},
  }, [port2]);
  const pending = new Map();
  // A worker that fails fails every fetch, waiting or later, instead of
  // leaving them unanswered.
  let senderFailed;
  sender.onerror = (event) => {
    event.preventDefault();
    senderFailed = {name: "TypeError", message: `fetch is unavailable: ${event.message}`};
    mapForEach(pending, (settle) => settle({error: senderFailed}));
    mapClear(pending);
  };
  let nextRequest = 0;
  // `data` is the event's own property, which no prototype rewrite reaches.
  fetcher.onmessage = ({data}) => {
    const settle = mapGet(pending, data.id);
    if (settle === undefined) return;
    mapDelete(pending, data.id);
    settle(data);
  };
  const failure = ({name, message}) => {
    if (name === "AbortError") return new NativeDOMException(message, name);
    if (name === "TypeError") return new NativeTypeError(message);
    // A permission error keeps its class, `Deno.errors.NotCapable`.
    if (denoErrors[name] !== undefined) return new denoErrors[name](message);
    return new NativeError(message);
  };
  // What a constructed Response can't say itself, on it and on its clones.
  // Its headers stay mutable, unlike a fetched response's.
  const dress = (response, url, redirected, type) => {
    defineProperty(response, "url", {value: url});
    defineProperty(response, "redirected", {value: redirected});
    defineProperty(response, "type", {value: type});
    defineProperty(response, "clone", {value: () => dress(responseClone(response), url, redirected, type)});
    return response;
  };
  // Async, so a refusal or a throw in here rejects like a failed fetch.
  globalThis.fetch = async (input, init) => {
    const request = new NativeRequest(input, init);
    const signal = requestSignal(request);
    if (signalAborted(signal)) throw signalReason(signal);
    const headers = [];
    headersForEach(requestHeaders(request), (value, name) => {
      headers[headers.length] = [name, value];
    });
    const options = {__proto__: null};
    for (let index = 0; index < requestOptions.length; index++) {
      options[requestOptions[index][0]] = requestOptions[index][1](request);
    }
    // A Request keeps no priority; it is read from the options it was given.
    if (init !== null && typeof init === "object" && typeof init.priority === "string") options.priority = init.priority;
    // Read whole, so the request keeps its length, as a direct fetch sends it.
    const body = requestBody(request) === null ? null : await requestArrayBuffer(request);
    // An abort while the body was read fired before the listener below.
    if (signalAborted(signal)) throw signalReason(signal);
    if (senderFailed !== undefined) throw failure(senderFailed);
    const id = nextRequest++;
    const answer = await new NativePromise((resolve, reject) => {
      mapSet(pending, id, resolve);
      // Also after the answer, to stop the body. Only the id crosses: the
      // reason is the program's, and the worker never sees its values.
      addEventListener(signal, "abort", () => {
        postMessage(fetcher, {abort: id});
        if (mapGet(pending, id) === undefined) return;
        mapDelete(pending, id);
        reject(signalReason(signal));
      }, {__proto__: null, once: true});
      postMessage(fetcher, {
        id, request: {url: requestUrl(request), method: requestMethod(request), headers, body, options},
      }, body === null ? [] : [body]);
    });
    if (answer.error !== undefined) throw failure(answer.error);
    const {status, statusText, headers: received, url, redirected, type, body: stream} = answer.response;
    // Piped with the signal, so an abort errors the body with its reason.
    let relayed = null;
    if (stream !== null) {
      const relay = new NativeTransformStream();
      // The source, which crosses to the worker, is cancelled without the
      // program's reason: only the request's id reaches the worker.
      promiseCatch(pipeTo(stream, relayWritable(relay), {__proto__: null, signal, preventCancel: true}), () => {
        promiseCatch(cancelStream(stream), () => {});
      });
      relayed = relayReadable(relay);
    }
    const response = new NativeResponse(relayed, {__proto__: null, status, statusText});
    // Appended one by one: an init's headers are read through iterators.
    const answered = responseHeaders(response);
    for (let index = 0; index < received.length; index++) appendHeader(answered, received[index][0], received[index][1]);
    return dress(response, url, redirected, type);
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
  for (const name of ["connect", "connectTls", "startTls", "listen", "listenTls", "serve", "serveHttp", "upgradeWebSocket", "createHttpClient", "HttpClient"]) {
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
