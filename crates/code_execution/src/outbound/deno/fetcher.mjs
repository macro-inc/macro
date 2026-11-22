// The run's only sender: a worker the bootstrap starts before the program
// loads, so its realm (built-ins, prototypes, Deno's own fetch internals) is
// one the program never reaches. The program's realm sends it each request as
// plain data; this realm marks it, holds back a dry run's writes, routes it to
// the forwarder and sends it. The first message is the run's settings and the
// port requests arrive on. The program can reach that port, so every message
// on it is checked here, and nothing it posts can make this realm throw: an
// error the program saw would hand it this worker.
let settings;
const inFlight = new Map();

const defaultPort = (protocol) => {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
};
// What `--allow-net` grants: host and port, whatever the scheme (a proxied
// client sends `http://host:443/...` over TLS), with `host.` read as `host`.
const destinationOf = (url) => {
  const parsed = new URL(url);
  const hostname = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
  return `${hostname}:${parsed.port || defaultPort(parsed.protocol)}`;
};

function configure({hosts, operations, dryRun, traceHeaders, forwarder}) {
  // Each route as the requests to its own service's host and whole path, so
  // a write whose path merely ends like a read's (`/web/search`) isn't one.
  const routes = operations.flatMap(operation => {
    const host = hosts[operation.key.slice(0, operation.key.indexOf("."))];
    if (!host) return [];
    const base = new URL(host).pathname.replace(/\/$/, "");
    const path = `${base}${operation.path}`.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+");
    return [{method: operation.method, write: operation.write, destination: destinationOf(host), pattern: new RegExp(`^${path}$`)}];
  });
  return {
    dryRun,
    routes,
    destinations: new Set(Object.values(hosts).map(destinationOf)),
    traceHeaders: Object.entries(traceHeaders).filter(([name]) => name === "traceparent" || name === "tracestate"),
    // A proxied run reaches only its forwarder, longest service base first.
    forwarded: Object.entries(forwarder)
      .map(([service, local]) => [hosts[service].replace(/\/$/, ""), local])
      .sort(([left], [right]) => right.length - left.length),
  };
}

async function send({url, method, headers, body, options}) {
  // Parsed and normalized here, as Deno's fetch would, so what is checked is
  // what is sent.
  const request = new Request(url, {method, headers, body});
  const {protocol} = new URL(request.url);
  if (protocol !== "http:" && protocol !== "https:") throw new TypeError("Only http and https URLs can be fetched.");
  // A proxied run's `--allow-net` names only its forwarder, so a request that
  // isn't under a service's own URL could only reach the forwarder by
  // another spelling of its address (`[::ffff:127.0.0.1]`, `2130706433`).
  // Refused whatever the spelling, since the program names a service by its
  // own URL.
  let target = request.url;
  if (settings.forwarded.length > 0) {
    const route = settings.forwarded.find(([base]) =>
      request.url === base || request.url.startsWith(`${base}/`) || request.url.startsWith(`${base}?`));
    if (route === undefined) throw new TypeError("Fetch a service by its own URL, not the run's forwarder.");
    target = `${route[1]}${request.url.slice(route[0].length)}`;
  }
  const sent = new Headers(request.headers);
  const init = {...options, method: request.method, headers: sent, body: request.body === null ? null : body};
  // Every request to an SDK origin, whatever credential it carries.
  if (settings.destinations.has(destinationOf(request.url))) {
    for (const [name, value] of settings.traceHeaders) sent.set(name, value);
    // Marks the request as a program's, not a person's in the app, so an API
    // can ask it to confirm what a person would have chosen by opening it.
    sent.set("x-macro-code-execution", "1");
    // A dry run's backstop: a request to an SDK origin that didn't come
    // through the gate is sent only if a read matches its route.
    if (settings.dryRun && request.method !== "GET" && request.method !== "HEAD") {
      const destination = destinationOf(request.url);
      const path = new URL(request.url).pathname;
      const read = settings.routes.some(route => route.method === request.method && !route.write
        && route.destination === destination && route.pattern.test(path));
      if (!read) throw new Error("A dry run doesn't send changes.");
      // A redirect would resend the read's method and body somewhere else.
      init.redirect = "error";
    }
  }
  return fetch(target, init);
}

// Built from the error's own strings only: formatting anything else could
// throw here.
const failure = (error) => ({
  name: typeof error?.name === "string" ? error.name : "Error",
  message: typeof error?.message === "string" ? error.message : "fetch failed",
});

async function answer(port, data) {
  if (data === null || typeof data !== "object") return;
  if (data.abort !== undefined) {
    inFlight.get(data.abort)?.abort();
    return;
  }
  const {id, request} = data;
  if (typeof id !== "number") return;
  if (request === null || typeof request !== "object") {
    port.postMessage({id, error: {name: "TypeError", message: "A malformed request was refused."}});
    return;
  }
  const controller = new AbortController();
  inFlight.set(id, controller);
  try {
    const response = await send({...request, options: {...request.options, signal: controller.signal}});
    // Relayed, so an abort reaches the body until it ends.
    let body = null;
    if (response.body) {
      const relay = new TransformStream();
      response.body.pipeTo(relay.writable).catch(() => {}).finally(() => inFlight.delete(id));
      body = relay.readable;
    } else {
      inFlight.delete(id);
    }
    port.postMessage({
      id,
      response: {
        status: response.status, statusText: response.statusText, headers: [...response.headers],
        url: response.url, redirected: response.redirected, type: response.type, body,
      },
    }, body ? [body] : []);
  } catch (error) {
    inFlight.delete(id);
    try {
      port.postMessage({id, error: failure(error)});
    } catch {
      port.postMessage({id, error: {name: "Error", message: "fetch failed"}});
    }
  }
}

// Nothing here may reach the bootstrap as an error event.
self.addEventListener("unhandledrejection", (event) => event.preventDefault());
self.addEventListener("error", (event) => event.preventDefault());

self.onmessage = ({data}) => {
  if (settings !== undefined) return;
  settings = configure(data);
  const {port} = data;
  port.onmessage = ({data}) => {
    answer(port, data).catch(() => {});
  };
};
