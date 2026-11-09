// `macro:client`, the module a document's client script imports. It types the
// preview frame's injected `window.macro`; programs come typed from
// `macro:programs`, which calls `run` here.

/**
 * A live event: the event name and the entity it is about, never its data.
 * `macro.resync` follows a reconnect that may have missed events, and
 * `macro.error` reports a refused subscription.
 */
export type MacroEvent = {
  type: string;
  id: string | null;
  message?: string;
};

type Host = {
  run(program: string, args: unknown): Promise<unknown>;
  on(
    events: readonly string[],
    handler: (event: MacroEvent) => void,
    options?: { ids?: readonly string[] },
  ): () => void;
};

const host = (globalThis as unknown as { macro: Host }).macro;

/** Run one of this document's programs on the server as the viewer. */
export function run<T>(program: string, args: unknown): Promise<T> {
  return host.run(program, args) as Promise<T>;
}

/**
 * Hear the viewer's live entity events, such as `document.updated`; pass
 * `ids` to hear about those entities only. Returns a function that stops
 * listening.
 */
export function on(
  events: readonly string[],
  handler: (event: MacroEvent) => void,
  options?: { ids?: readonly string[] },
): () => void {
  return host.on(events, handler, options);
}
