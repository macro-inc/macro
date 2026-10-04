/**
 * Typed surface of the generated wasm package (`docx_engine`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-docx-engine-wasm
 * which runs wasm-pack over crates/docx_engine into
 * src/lib/core/docx-engine/wasm/ (gitignored).
 */

/**
 * One open document with its editing session. Mirrors
 * `docx_engine::wasm::DocxDocument`. Structured results are JSON strings;
 * every method throws an `Error` when the engine rejects the call.
 */
export interface WasmDocxDocument {
  /** The shared state (`CollabState` JSON). */
  collabState: () => string;
  setExternalUndo: (external: boolean) => void;
  setAuthor: (author: string) => void;
  /** Applies an `EditOp[]` JSON batch; returns `EditResult` JSON. */
  apply: (ops: string, group?: string) => string;
  /** Applies `RemoteChange[]` JSON; returns `EditResult` JSON. */
  applyRemote: (changes: string) => string;
  /** `EditResult` JSON for the current state. */
  state: () => string;
  /** `PageInfo[]` JSON. */
  pages: () => string;
  /** Straight-alpha RGBA, `width × height × 4` bytes. */
  render: (page: number, width: number) => Uint8Array;
  /** A strip of a page (`top..bottom` points) at the page width `width`. */
  renderBand: (
    page: number,
    width: number,
    top: number,
    bottom: number
  ) => Uint8Array;
  /** `Pos` JSON or `null`. */
  hitTest: (page: number, x: number, y: number) => string;
  /** `CaretRect` JSON or `null`. */
  caretAt: (pos: string) => string;
  /** `PageRect[]` JSON. */
  rangeRects: (from: string, to: string) => string;
  /** The selected text, for the clipboard. */
  selectedText: () => string;
  /** `ParagraphText[]` JSON. */
  paragraphs: () => string;
  /** `StyleInfo[]` JSON. */
  styles: () => string;
  /** Shows tracked changes inline or not; returns `EditResult` JSON. */
  setMarkup: (markup: boolean) => string;
  breakGroup: () => void;
  undo: () => string | undefined;
  redo: () => string | undefined;
  canUndo: () => boolean;
  canRedo: () => boolean;
  save: () => Uint8Array;
  /** JSON array of requested font families that are not available. */
  missingFonts: () => string;
  free: () => void;
}

interface DocxEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  DocxDocument: {
    new (bytes: Uint8Array): WasmDocxDocument;
    /** Opens the document a `CollabState` JSON describes. */
    fromCollab: (state: string, seed: number) => WasmDocxDocument;
    /** Opens a document stored in the first shared format (`V1State` JSON). */
    fromV1: (state: string) => WasmDocxDocument;
  };
  registerFont: (bytes: Uint8Array) => number;
}

let modulePromise: Promise<DocxEngineWasmModule> | undefined;
let generation = 0;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadDocxEngineWasm(): Promise<DocxEngineWasmModule> {
  if (!modulePromise) {
    const instance = generation;
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/docx_engine.js', import.meta.url);
        // A replacement instance needs its own copy of the generated module,
        // whose memory lives in module-level state.
        if (instance > 0) base.searchParams.set('instance', String(instance));
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as DocxEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/docx_engine_bg.wasm', import.meta.url);
        await mod.default({ module_or_path: wasmUrl });
        return mod;
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}

/**
 * Discards the current instance after a trap (a Rust panic aborts the
 * instance and can leave its objects unusable); the next load starts fresh.
 */
export function discardDocxEngineWasm(): void {
  modulePromise = undefined;
  generation++;
}

/** Whether an error came from a trapped (panicked) wasm instance. */
export function isWasmTrap(error: unknown): boolean {
  if (
    typeof WebAssembly !== 'undefined' &&
    error instanceof WebAssembly.RuntimeError
  )
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unreachable|recursive use of an object|already borrowed|already mutably borrowed/i.test(
    message
  );
}
