/**
 * Typed surface of the generated wasm package (`psd_engine`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-psd-engine-wasm
 * which runs wasm-pack over crates/psd_engine into
 * src/lib/core/psd-engine/wasm/ (gitignored).
 */

/** One open Photoshop document. Mirrors `psd_engine::wasm::PsdFile`. */
export interface WasmPsdFile {
  /** `Summary` JSON. */
  summary: () => string;
  /** `string[]` JSON: what could not be read. */
  warnings: () => string;
  /** `LayerRow[]` JSON, top to bottom. */
  layers: () => string;
  /** `LayerInfo` JSON (`null` when unknown). */
  layerInfo: (id: number) => string;
  /** Straight RGBA of the canvas scaled by `1/2^level`. */
  render: (
    x: number,
    y: number,
    level: number,
    width: number,
    height: number
  ) => Uint8Array;
  hitTest: (x: number, y: number) => number | undefined;
  /** Straight RGBA of one pixel. */
  sample: (x: number, y: number, layer?: number | null) => Uint8Array;
  /** PNG (empty when the layer draws nothing). */
  thumbnail: (id: number, size: number) => Uint8Array;
  /** Gray PNG of the layer's mask over the canvas (empty without one). */
  maskThumbnail: (id: number, size: number) => Uint8Array;
  /** PNG of the merged image. */
  preview: (size: number) => Uint8Array;
  /** `FontUse[]` JSON. */
  fonts: () => string;
  describe: () => string;
  /** `EditResult` JSON. */
  apply: (ops: string, coalesce?: string | null) => string;
  undo: () => string;
  redo: () => string;
  /** `SelectionInfo` JSON. */
  select: (spec: string) => string;
  selectionInfo: () => string;
  /** PNG. */
  copyPixels: (layer?: number | null) => Uint8Array;
  /** `EditResult` JSON. */
  placeImage: (
    bytes: Uint8Array,
    name: string,
    x?: number | null,
    y?: number | null,
    above?: number | null
  ) => string;
  /** PNG. */
  exportPng: (layer?: number | null) => Uint8Array;
  /** JPEG over white. */
  exportJpeg: (quality: number) => Uint8Array;
  save: () => Uint8Array;
  isEdited: () => boolean;
  /** `EntryChange[]` JSON to write. */
  enableCollab: (
    session: number,
    layers: string | null | undefined,
    seed: boolean
  ) => string;
  /** `EntryChange[]` JSON of this person's steps since the last call. */
  collabChanges: () => string;
  /** Other people's `EntryChange[]` JSON; returns `EditResult` JSON. */
  applyCollab: (changes: string) => string;
  /** The `layers:<fingerprint>` value for the file `save` writes now. */
  fileLayers: () => string;
  free: () => void;
}

interface PsdEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  PsdFile: {
    new (bytes: Uint8Array): WasmPsdFile;
    /** A new document's file: a white Background, or one transparent layer. */
    blank: (width: number, height: number, white: boolean) => Uint8Array;
    /** Registers a font for text layout; `RegisteredFace[]` JSON. */
    registerFont: (bytes: Uint8Array, family?: string | null) => string;
  };
}

let modulePromise: Promise<PsdEngineWasmModule> | undefined;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadPsdEngineWasm(): Promise<PsdEngineWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/psd_engine.js', import.meta.url);
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as PsdEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/psd_engine_bg.wasm', import.meta.url);
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
