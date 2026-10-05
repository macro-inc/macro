/**
 * Typed surface of the generated wasm package (`fig_engine`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-fig-engine-wasm
 * which runs wasm-pack over crates/fig_engine into
 * src/lib/core/fig-engine/wasm/ (gitignored).
 */

/** One open `.fig` file. Mirrors `fig_engine::wasm::FigFile`. */
export interface WasmFigFile {
  /** Whether the whole file is decoded (opening decodes the first page). */
  isComplete: () => boolean;
  /** Decodes about `nodes` more nodes; whether the file is complete. */
  decodeSome: (nodes: number) => boolean;
  /** `FileSummary` JSON. */
  summary: () => string;
  components: () => string;
  /** `StyleInfo[]` JSON. */
  styles: () => string;
  /** `CollectionInfo[]` JSON. */
  variables: () => string;
  /** `DesignInfo` JSON. */
  designInfo: (page: number, id: string) => string;
  /** `PageLayout` JSON. */
  openPage: (page: number) => string;
  /** Premultiplied RGBA, `width × height × 4` bytes. */
  render: (
    page: number,
    x: number,
    y: number,
    scale: number,
    width: number,
    height: number,
    outline: boolean
  ) => Uint8Array;
  /** `LayerRow[]` JSON. */
  layers: (page: number, parent?: string | null) => string;
  /** `LayerRow[]` JSON for a JSON array of ids. */
  rows: (page: number, ids: string) => string;
  /** `NodeInfo` JSON. */
  nodeInfo: (page: number, id: string) => string;
  /** `LayerRow[]` JSON. */
  hitTest: (page: number, x: number, y: number, tolerance: number) => string;
  /** `LayerRow[]` JSON. */
  ancestry: (page: number, id: string) => string;
  /** `NodeGeometry[]` JSON for a JSON array of ids. */
  geometry: (page: number, ids: string) => string;
  /** SVG path data, page coordinates. */
  outline: (page: number, id: string) => string;
  /** `LayoutAids` JSON. */
  layoutAids: (page: number) => string;
  /** `Exportable[]` JSON. */
  exportables: (page: number, id: string) => string;
  /** Layers exported with presets (`ExportRequest` JSON). */
  exportFiles: (page: number, request: string) => WasmExportFile;
  /** The page's top-level frames as a PDF. */
  exportFramesPdf: (page: number) => Uint8Array;
  /** `PrototypeInfo` JSON. */
  prototype: (page: number) => string;
  /** `SearchHit[]` JSON. */
  search: (page: number, query: string, limit: number) => string;
  /** `string[]` JSON of `RRGGBB[AA]` colors. */
  pageColors: (page: number, limit: number) => string;
  /** `string[]` JSON. */
  inRect: (
    page: number,
    parent: string | null | undefined,
    x: number,
    y: number,
    width: number,
    height: number
  ) => string;
  /** PNG bytes. */
  exportPng: (page: number, id: string, scale: number) => Uint8Array;
  thumbnail: () => Uint8Array | undefined;
  /** `EditResult` JSON. */
  apply: (page: number, ops: string, coalesce?: string | null) => string;
  undo: (page: number) => string;
  redo: (page: number) => string;
  /** The edited file as `.fig` bytes. */
  save: () => Uint8Array;
  isEdited: () => boolean;
  /** `[width, height]` JSON. */
  addImage: (hash: string, bytes: Uint8Array) => string;
  /** `EntryChange[]` JSON to write. */
  enableCollab: (session: number, baseBlobs?: number | null) => string;
  /** `EntryChange[]` JSON of this person's changes since the last call. */
  collabChanges: () => string;
  /** Other people's `EntryChange[]` JSON; returns `EditResult` JSON. */
  applyCollab: (page: number, changes: string) => string;
  /** `FontUse[]` JSON: the fonts the document's text uses. */
  fonts: () => string;
  /** `TextGeometry` JSON (`null` for other layers). */
  textGeometry: (page: number, id: string) => string;
  /** An SVG document of one layer. */
  exportSvg: (page: number, id: string) => string;
  /** `VectorNetwork` JSON in page coordinates, if the layer has points. */
  vectorNetwork: (page: number, id: string) => string | undefined;
  /** Copies layers (`string[]` JSON). */
  copy: (page: number, ids: string) => WasmClipboard;
  /** Pastes copied layers; `PasteSpec` JSON in, `EditResult` JSON out. */
  paste: (
    page: number,
    document: Uint8Array,
    images: Uint8Array | null | undefined,
    spec: string
  ) => string;
  free: () => void;
}

/** An exported file. Mirrors `fig_engine::wasm::ExportFile`. */
export interface WasmExportFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  free: () => void;
}

/** Copied layers. Mirrors `fig_engine::wasm::Clipboard`. */
export interface WasmClipboard {
  /** A `.fig` document holding the layers. */
  readonly document: Uint8Array;
  /** A ZIP of the images they use (empty when none). */
  readonly images: Uint8Array;
  free: () => void;
}

interface FigEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  FigFile: {
    new (bytes: Uint8Array): WasmFigFile;
    /** A new design with one empty page. */
    blank: (name: string) => Uint8Array;
    /** Registers a font for layout; `RegisteredFace[]` JSON. */
    registerFont: (bytes: Uint8Array, family?: string) => string;
  };
}

let modulePromise: Promise<FigEngineWasmModule> | undefined;

/** Loads and initializes the wasm module once per worker; a failed load is tried again. */
export function loadFigEngineWasm(): Promise<FigEngineWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/fig_engine.js', import.meta.url);
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as FigEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/fig_engine_bg.wasm', import.meta.url);
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
