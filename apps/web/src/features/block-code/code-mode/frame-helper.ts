/**
 * The `window.macro` transport an HTML preview frame gets, and the messages
 * it exchanges with the host. Pages never call it directly: the server's
 * build compiles the client's `macro:programs` and `macro:client` imports
 * onto it. The frame never holds a credential and never sends code: it names
 * a program of the build it shows, and the host runs that program on the
 * server as the viewer and sends only the outcome back.
 */

/** Frame → host: run one program of the page's build. */
export type RunRequestMessage = {
  type: 'macro:run';
  token: string;
  id: number;
  /** The program's id, as the build named it. */
  program: string;
  arguments: Record<string, unknown>;
};

/** Host → frame: the program's outcome. */
export type RunReplyMessage =
  | { type: 'macro:result'; token: string; id: number; result: unknown }
  | { type: 'macro:error'; token: string; id: number; message: string };

/** Frame → host: deliver these events to subscription `subscription`. */
export type SubscribeMessage = {
  type: 'macro:subscribe';
  token: string;
  subscription: number;
  events: string[];
  /** Entity ids to narrow to; absent means every entity. */
  ids?: string[];
};

/** Frame → host: stop subscription `subscription`. */
export type UnsubscribeMessage = {
  type: 'macro:unsubscribe';
  token: string;
  subscription: number;
};

/**
 * What a `macro.on` handler receives: the event name and the entity id it is
 * about, never its data; the page runs a program to read what changed.
 * `macro.resync` follows a reconnect that may have missed events, and
 * `macro.error` reports a refused subscription.
 */
export type FrameEvent = {
  type: string;
  id: string | null;
  message?: string;
};

/**
 * Frame → host: the page is unloading, as it does when it navigates itself.
 * Its policy blocks every other network path, so the host closes the frame.
 */
export type LeavingMessage = { type: 'macro:leaving'; token: string };

/** Host → frame: one event for one subscription. */
export type EventMessage = {
  type: 'macro:event';
  token: string;
  subscription: number;
  event: FrameEvent;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Narrow a frame message to a subscription change carrying the frame's token. */
export function readSubscriptionMessage(
  data: unknown,
  token: string
): SubscribeMessage | UnsubscribeMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as Record<string, unknown>;
  if (message.token !== token || typeof message.subscription !== 'number')
    return undefined;
  if (message.type === 'macro:unsubscribe')
    return {
      type: 'macro:unsubscribe',
      token,
      subscription: message.subscription,
    };
  if (message.type !== 'macro:subscribe' || !isStringArray(message.events))
    return undefined;
  return {
    type: 'macro:subscribe',
    token,
    subscription: message.subscription,
    events: message.events,
    ...(isStringArray(message.ids) ? { ids: message.ids } : {}),
  };
}

/** Narrow a frame message to a run request carrying the frame's token. */
export function readRunRequest(
  data: unknown,
  token: string
): RunRequestMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as Record<string, unknown>;
  if (
    message.type !== 'macro:run' ||
    message.token !== token ||
    typeof message.id !== 'number' ||
    typeof message.program !== 'string'
  )
    return undefined;
  const args =
    typeof message.arguments === 'object' &&
    message.arguments !== null &&
    !Array.isArray(message.arguments)
      ? (message.arguments as Record<string, unknown>)
      : {};
  return {
    type: 'macro:run',
    token,
    id: message.id,
    program: message.program,
    arguments: args,
  };
}

/**
 * Script injected at the head's start so it runs before the document's own
 * code. `macro.run(program, args)` runs that program of the page's build and
 * resolves to the value it returned. `macro.on(events, handler, {ids})` calls
 * `handler` with a {@link FrameEvent} for each matching live event and
 * returns `off`.
 */
export const frameHelperScript = (token: string) =>
  `(function (host, token) {
    var next = 1;
    var pending = {};
    function run(program, args) {
      return new Promise(function (resolve, reject) {
        var id = next++;
        pending[id] = { resolve: resolve, reject: reject };
        host.postMessage({ type: 'macro:run', token: token, id: id, program: String(program), arguments: args && typeof args === 'object' ? args : {} }, '*');
      });
    }
    var handlers = {};
    var nextSubscription = 1;
    function on(events, handler, options) {
      if (typeof handler !== 'function') throw new TypeError('macro.on needs a handler function');
      var names = typeof events === 'string' ? [events] : Array.prototype.slice.call(events || []);
      var ids = options && options.ids ? Array.prototype.slice.call(options.ids) : undefined;
      var subscription = nextSubscription++;
      handlers[subscription] = handler;
      host.postMessage({ type: 'macro:subscribe', token: token, subscription: subscription, events: names, ids: ids }, '*');
      return function off() {
        if (!handlers[subscription]) return;
        delete handlers[subscription];
        host.postMessage({ type: 'macro:unsubscribe', token: token, subscription: subscription }, '*');
      };
    }
    addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== host || !data || data.token !== token) return;
      if (data.type === 'macro:event') {
        var handler = handlers[data.subscription];
        if (!handler) return;
        try { handler(data.event); } catch (error) { setTimeout(function () { throw error; }); }
        return;
      }
      var waiter = pending[data.id];
      if (!waiter) return;
      delete pending[data.id];
      if (data.type === 'macro:result') waiter.resolve(data.result);
      else if (data.type === 'macro:error') waiter.reject(new Error(String(data.message)));
    });
    function leaving() { host.postMessage({ type: 'macro:leaving', token: token }, '*'); }
    addEventListener('beforeunload', leaving);
    addEventListener('pagehide', leaving);
    Object.defineProperty(window, 'macro', { value: Object.freeze({ run: run, on: on }), writable: false, configurable: false });
  })(parent, ${JSON.stringify(token)});`;

/**
 * The built page's content security policy. A page runs programs as the
 * viewer, so it may only run its own inline code and show inline media: no
 * fetch, beacon, remote script, stylesheet or image can carry what it read
 * out of the frame. It does not stop the frame navigating itself; the helper
 * reports that (`macro:leaving`) and the host closes the frame.
 */
export const PROGRAM_DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The preview document with its policy and the helper installed. Parsing and
 * reserializing keeps both first in `<head>`, the policy before any script,
 * even for documents without a head.
 */
export function composeProgramDocument(html: string, token: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = PROGRAM_DOCUMENT_CSP;
  const helper = parsed.createElement('script');
  helper.textContent = frameHelperScript(token);
  parsed.head.prepend(policy, helper);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}
