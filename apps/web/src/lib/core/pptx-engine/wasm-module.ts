/**
 * Typed surface of the generated wasm package (`pptx_engine`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-pptx-engine-wasm
 * which runs wasm-pack over crates/pptx_engine into
 * src/lib/core/pptx-engine/wasm/ (gitignored).
 */

/**
 * One open presentation with its undo history. Mirrors
 * `pptx_engine::wasm::PptxDocument`. Structured results are JSON strings;
 * every method throws an `Error` when the engine rejects the call.
 */
export interface WasmPptxDocument {
  slideCount: () => number;
  /** `[width, height]` in points. */
  slideSize: () => Float64Array;
  /** `DeckOutline` JSON. */
  outline: () => string;
  /** `SlideOutline` JSON. */
  slideOutline: (index: number) => string;
  /** Straight-alpha RGBA, `width × height × 4` bytes. */
  render: (index: number, width: number) => Uint8Array;
  /** One layer: everything `without` the shape, or `only` the shape. */
  renderLayer: (
    index: number,
    width: number,
    mode: 'without' | 'only',
    shape: number
  ) => Uint8Array;
  /** `TextLayoutInfo` JSON, or `null`. */
  textLayout: (index: number, shape: number) => string;
  /** Applies an `EditOp[]` JSON batch; returns `EditResult` JSON. */
  apply: (ops: string, group?: string) => string;
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

interface PptxEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  PptxDocument: new (bytes: Uint8Array) => WasmPptxDocument;
  registerFont: (bytes: Uint8Array) => number;
}

let modulePromise: Promise<PptxEngineWasmModule> | undefined;
let generation = 0;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadPptxEngineWasm(): Promise<PptxEngineWasmModule> {
  if (!modulePromise) {
    const instance = generation;
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/pptx_engine.js', import.meta.url);
        // A replacement instance needs its own copy of the generated module,
        // whose memory lives in module-level state.
        if (instance > 0) base.searchParams.set('instance', String(instance));
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as PptxEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/pptx_engine_bg.wasm', import.meta.url);
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
export function discardPptxEngineWasm(): void {
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
