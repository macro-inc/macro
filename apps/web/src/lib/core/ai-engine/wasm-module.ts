/**
 * Typed surface of the generated wasm package (`ai_engine`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-ai-engine-wasm
 * which runs wasm-pack over crates/ai_engine into
 * src/lib/core/ai-engine/wasm/ (gitignored).
 */

/** One open document. Mirrors `ai_engine::wasm::AiFile`. */
export interface WasmAiFile {
  /** `Summary` JSON. */
  summary: () => string;
  /** `string[]` JSON. */
  warnings: () => string;
  /** `Row[]` JSON. */
  rows: () => string;
  /** `Info` JSON (`null` when unknown). */
  info: (id: number) => string;
  /** Straight RGBA, `width × height × 4` bytes. */
  render: (
    x: number,
    y: number,
    scale: number,
    width: number,
    height: number,
    artboards: boolean,
    outline: boolean
  ) => Uint8Array;
  /** PNG bytes (empty when the node draws nothing). */
  thumbnail: (id: number, size: number) => Uint8Array;
  /** PNG bytes. */
  exportPng: (
    artboard: number | null | undefined,
    scale: number,
    transparent: boolean
  ) => Uint8Array;
  hitTest: (
    x: number,
    y: number,
    scale: number,
    deep: boolean
  ) => number | undefined;
  /** `number[]` JSON. */
  inRect: (x: number, y: number, w: number, h: number, deep: boolean) => string;
  /** `Rect` JSON or `null`, for a JSON array of ids. */
  bounds: (ids: string) => string;
  /** `FontUse[]` JSON. */
  fonts: () => string;
  /** `TextGeometry` JSON (`null` for other nodes). */
  textGeometry: (id: number) => string;
  describe: () => string;
  /** `EditResult` JSON. */
  apply: (ops: string, coalesce?: string | null) => string;
  undo: () => string;
  redo: () => string;
  /** `EditResult` JSON. */
  placeImage: (
    bytes: Uint8Array,
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    parent?: number | null
  ) => string;
  /** The edited file, as `.ai` (PDF) bytes. */
  save: () => Uint8Array;
  isEdited: () => boolean;
  /** `EntryChange[]` JSON to write. */
  enableCollab: (session: number, seed: boolean) => string;
  /** `EntryChange[]` JSON of this person's changes since the last call. */
  collabChanges: () => string;
  /** Other people's `EntryChange[]` JSON; returns `EditResult` JSON. */
  applyCollab: (changes: string) => string;
  free: () => void;
}

interface AiEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  AiFile: {
    new (bytes: Uint8Array): WasmAiFile;
    /** A new document's file: one artboard of `width × height` points. */
    blank: (width: number, height: number) => Uint8Array;
    /** Registers a font for layout; `RegisteredFace[]` JSON. */
    registerFont: (bytes: Uint8Array, family?: string | null) => string;
  };
}

let modulePromise: Promise<AiEngineWasmModule> | undefined;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadAiEngineWasm(): Promise<AiEngineWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/ai_engine.js', import.meta.url);
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as AiEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/ai_engine_bg.wasm', import.meta.url);
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
