/**
 * The contract between a fuzz peer's page and the Playwright process. The page
 * offers `LexFuzzApi` as `window.lexFuzz`; the test exposes `FuzzWire` with
 * `page.exposeFunction` and hands messages back through `LexFuzzApi.deliver`.
 * Both sides read the page's globals through `FuzzWindow`, so nothing here
 * augments the app's `Window`.
 */

/** A message from the sync server, base64-encoded. */
export type WireEvent = { type: 'update' | 'awareness'; bytes: string };

/** A top-level block as the oracle sees it. */
export type FuzzBlock = { type: string; text: string; indent?: number };

/** Lexical's caret: the text of its block, and how much of it is before the caret. */
export type FuzzCaret = {
  collapsed: boolean;
  blockType: string;
  text: string;
  before: string;
};

/** What a peer's page offers the test. */
export type LexFuzzApi = {
  /** Hands this peer a message from the server. */
  deliver: (event: WireEvent) => void;
  /** A server snapshot holding `markdown`, as a new document's would. */
  seed: (markdown: string) => Promise<string>;
  ready: () => boolean;
  editorMarkdown: () => string;
  loroMarkdown: () => string;
  editorJson: () => string;
  loroJson: () => string;
  blocks: () => FuzzBlock[];
  invariants: () => string[];
  errors: () => string[];
  /** Caret at the end of the top-level block whose text starts with `prefix`. */
  placeAtEnd: (prefix: string) => boolean;
  /** Internal markdown of any serialized state (the server's, say). */
  toMarkdown: (json: string) => string;
  /** Internal markdown → state → internal markdown. */
  roundTrip: (markdown: string) => string;
  selection: () => FuzzCaret | null;
};

/** What the test exposes to a peer's page: the sync server's end of the socket. */
export type FuzzWire = {
  /** The server's snapshot, once the document is seeded. */
  fuzzConnect: () => Promise<string>;
  fuzzPush: (bytes: string) => Promise<boolean>;
  fuzzAwareness: (bytes: string) => Promise<void>;
  /** The server's updates since a version vector. */
  fuzzSince: (version: string) => Promise<string>;
};

/** A peer page's globals; `Window` is assignable to it without a cast. */
export type FuzzWindow = Window & Partial<FuzzWire> & { lexFuzz?: LexFuzzApi };
