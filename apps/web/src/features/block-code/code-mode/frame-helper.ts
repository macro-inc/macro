/**
 * The `window.macro` helper an HTML preview frame gets, and the messages it
 * exchanges with the host. The frame never holds a credential: it sends the
 * program's source and inputs up, and the host runs them on the server as
 * the viewer and sends only the outcome back.
 */

/** MIME type of a program block: `<script type="text/macro" id="…">`. */
export const PROGRAM_BLOCK_TYPE = 'text/macro';

/** Frame → host: run a program. */
export type RunRequestMessage = {
  type: 'macro:run';
  token: string;
  id: number;
  source: string;
  arguments: Record<string, unknown>;
};

/** Host → frame: the program's outcome. */
export type RunReplyMessage =
  | { type: 'macro:result'; token: string; id: number; result: unknown }
  | { type: 'macro:error'; token: string; id: number; message: string };

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
    typeof message.source !== 'string'
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
    source: message.source,
    arguments: args,
  };
}

/**
 * Script injected at the head's start so it runs before the document's own
 * code. `macro.run(idOrSource, args)` runs the `text/macro` block with that
 * id, or the string itself as a module, and resolves to the value `main`
 * returned.
 */
export const frameHelperScript = (token: string) =>
  `(function (host, token) {
    var next = 1;
    var pending = {};
    function run(idOrSource, args) {
      var block = typeof idOrSource === 'string' ? document.getElementById(idOrSource) : null;
      var source = block && block.tagName === 'SCRIPT' && block.type === ${JSON.stringify(PROGRAM_BLOCK_TYPE)}
        ? block.textContent
        : String(idOrSource);
      return new Promise(function (resolve, reject) {
        var id = next++;
        pending[id] = { resolve: resolve, reject: reject };
        host.postMessage({ type: 'macro:run', token: token, id: id, source: source, arguments: args && typeof args === 'object' ? args : {} }, '*');
      });
    }
    addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== host || !data || data.token !== token) return;
      var waiter = pending[data.id];
      if (!waiter) return;
      delete pending[data.id];
      if (data.type === 'macro:result') waiter.resolve(data.result);
      else if (data.type === 'macro:error') waiter.reject(new Error(String(data.message)));
    });
    Object.defineProperty(window, 'macro', { value: Object.freeze({ run: run }), writable: false, configurable: false });
  })(parent, ${JSON.stringify(token)});`;

/**
 * The preview document with the helper installed. Parsing and reserializing
 * keeps the helper first in `<head>` even for documents without one.
 */
export function composeProgramDocument(html: string, token: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const helper = parsed.createElement('script');
  helper.textContent = frameHelperScript(token);
  parsed.head.prepend(helper);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}
