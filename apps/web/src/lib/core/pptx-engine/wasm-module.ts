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
  renderSpan: (
    index: number,
    width: number,
    start: number,
    end: number,
    backdrop: boolean
  ) => Uint8Array;
  /** `TextLayoutInfo` JSON, or `null`; with `row` and `col`, a table cell's. */
  textLayout: (
    index: number,
    shape: number,
    row?: number,
    col?: number
  ) => string;
  /** The bytes of a video or audio clip (`MediaOutline.part`). */
  mediaBytes: (part: string) => Uint8Array;
  /** `LinkRegion[]` JSON: a slide's clickable areas. */
  linkRegions: (index: number) => string;
  /** `ShapeGeometryInfo` JSON (or `null`): a shape's outline as paths. */
  geometryPaths: (index: number, shape: number) => string;
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
  /** Starts collaborative editing of a file opened from bytes. */
  enableCollab: (seed: number) => void;
  /** `EntryChange[]` JSON owed to the shared maps since the last call. */
  collabChanges: () => string;
  /** Applies `EntryChange[]` JSON from the shared maps; returns `EditResult` JSON. */
  applyCollab: (changes: string) => string;
  /** Clipboard payload JSON of shapes (`ids`: JSON array) of slide `index`. */
  copyShapes: (index: number, ids: string) => string;
  /** Clipboard payload JSON of slides (`ids`: JSON array of slide ids). */
  copySlides: (ids: string) => string;
  /** `TextMatch[]` JSON; `options` is `FindOptions` JSON. */
  findText: (query: string, options: string) => string;
  free: () => void;
}

interface PptxEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  PptxDocument: {
    new (bytes: Uint8Array): WasmPptxDocument;
    /** Opens the presentation shared `CollabEntries` JSON describe. */
    fromEntries: (entries: string, seed: number) => WasmPptxDocument;
  };
  registerFont: (bytes: Uint8Array) => number;
  /** `PresetPath[]` JSON for a preset at `w`×`h` points, or `null`. */
  presetPaths: (name: string, w: number, h: number) => string;
  /**
   * PNG of an equation in the linear format (`size` points, `scale` pixels
   * per point, `color` `RRGGBB`); throws what is wrong with the text.
   */
  renderEquation: (
    latex: string,
    display: boolean,
    size: number,
    scale: number,
    color: string
  ) => Uint8Array;
  /** `SmartArtCatalog` JSON. */
  smartArtCatalog: () => string;
  /** `SmartArtPreviewPath[]` JSON (or `null`) for `SmartArtPreviewSpec` JSON. */
  smartArtPreview: (spec: string) => string;
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
