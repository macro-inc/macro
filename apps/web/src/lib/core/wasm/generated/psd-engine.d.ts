/* tslint:disable */
/* eslint-disable */

/**
 * An open Photoshop document.
 */
export class PsdFile {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies operations (`Op[]` JSON) as one undoable step; steps with
     * the same `coalesce` key in a row undo together. Returns an
     * `EditResult` JSON.
     */
    apply(ops: string, coalesce?: string | null): string;
    /**
     * Applies other people's changes (`EntryChange[]` JSON); they do not
     * enter the undo history. Returns an `EditResult` JSON whose `wants`
     * lists tile key prefixes to pass back.
     */
    applyCollab(changes: string): string;
    /**
     * A new document's file: a white Background, or one transparent layer.
     */
    static blank(width: number, height: number, white: boolean): Uint8Array;
    /**
     * The `EntryChange[]` JSON that brings the shared maps up to date with
     * this person's steps since the last call.
     */
    collabChanges(): string;
    /**
     * The selected pixels (of a layer, or of the merged image) as PNG, for
     * the clipboard; the whole layer or canvas without a selection.
     */
    copyPixels(layer?: number | null): Uint8Array;
    /**
     * The document described for search and agents.
     */
    describe(): string;
    /**
     * Starts editing together: new layers get ids in `session`, `layers`
     * is the shared `layers:<fingerprint>` of the opened file when there
     * is one, and `seed` asks for every layer's state (the first person in
     * a new shared document). Returns `EntryChange[]` JSON to write.
     */
    enableCollab(session: number, layers: string | null | undefined, seed: boolean): string;
    /**
     * The merged image as JPEG over white.
     */
    exportJpeg(quality: number): Uint8Array;
    /**
     * One layer (or the merged image) as PNG.
     */
    exportPng(layer?: number | null): Uint8Array;
    /**
     * The `layers:<fingerprint>` value for the file `save` writes now.
     */
    fileLayers(): string;
    /**
     * Fonts text layers use and whether each is available (JSON).
     */
    fonts(): string;
    /**
     * The topmost layer drawing at canvas `(x, y)`.
     */
    hitTest(x: number, y: number): number | undefined;
    /**
     * Whether anything was edited since the file was opened.
     */
    isEdited(): boolean;
    /**
     * One layer's properties (`LayerInfo` JSON, `null` when unknown).
     */
    layerInfo(id: number): string;
    /**
     * The layers panel, top to bottom (`LayerRow[]` JSON).
     */
    layers(): string;
    /**
     * A layer's pixel mask over the canvas fitted in `size` pixels (gray
     * PNG; empty when the layer has no mask).
     */
    maskThumbnail(id: number, size: number): Uint8Array;
    /**
     * Opens a `.psd` or `.psb` file.
     */
    constructor(bytes: Uint8Array);
    /**
     * Places an image (PNG, JPEG, GIF, or WebP) as a new layer, centered
     * on `(x, y)` or the canvas; returns an `EditResult` JSON.
     */
    placeImage(bytes: Uint8Array, name: string, x?: number | null, y?: number | null, above?: number | null): string;
    /**
     * The merged image fitted in `size` pixels (PNG).
     */
    preview(size: number): Uint8Array;
    /**
     * Redoes the last undone step (`EditResult` JSON).
     */
    redo(): string;
    /**
     * Makes a font available to text layout (TTF, OTF, collection, WOFF,
     * or WOFF2), named `family` when given; returns its faces as JSON.
     */
    static registerFont(bytes: Uint8Array, family?: string | null): string;
    /**
     * Composites `width × height` pixels of the canvas scaled by
     * `1/2^level`, from `(x, y)` in that scale's pixels; straight RGBA.
     */
    render(x: number, y: number, level: number, width: number, height: number): Uint8Array;
    /**
     * The color at canvas `(x, y)` of the merged image or one layer
     * (straight RGBA).
     */
    sample(x: number, y: number, layer?: number | null): Uint8Array;
    /**
     * The edited file, as `.psd` bytes.
     */
    save(): Uint8Array;
    /**
     * Changes the selection (`SelectSpec` JSON); returns its bounds and
     * outline (JSON).
     */
    select(spec: string): string;
    /**
     * The selection's bounds and outline (JSON).
     */
    selectionInfo(): string;
    /**
     * The document's summary (`Summary` JSON).
     */
    summary(): string;
    /**
     * A layer's thumbnail (PNG, empty when it draws nothing).
     */
    thumbnail(id: number, size: number): Uint8Array;
    /**
     * Undoes the last step (`EditResult` JSON).
     */
    undo(): string;
    /**
     * What could not be read in the file (`string[]` JSON).
     */
    warnings(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_psdfile_free: (a: number, b: number) => void;
    readonly psdfile_apply: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly psdfile_applyCollab: (a: number, b: number, c: number) => [number, number, number, number];
    readonly psdfile_blank: (a: number, b: number, c: number) => [number, number, number, number];
    readonly psdfile_collabChanges: (a: number) => [number, number];
    readonly psdfile_copyPixels: (a: number, b: number) => [number, number];
    readonly psdfile_describe: (a: number) => [number, number];
    readonly psdfile_enableCollab: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly psdfile_exportJpeg: (a: number, b: number) => [number, number];
    readonly psdfile_exportPng: (a: number, b: number) => [number, number];
    readonly psdfile_fileLayers: (a: number) => [number, number];
    readonly psdfile_fonts: (a: number) => [number, number];
    readonly psdfile_hitTest: (a: number, b: number, c: number) => number;
    readonly psdfile_isEdited: (a: number) => number;
    readonly psdfile_layerInfo: (a: number, b: number) => [number, number];
    readonly psdfile_layers: (a: number) => [number, number];
    readonly psdfile_maskThumbnail: (a: number, b: number, c: number) => [number, number];
    readonly psdfile_new: (a: number, b: number) => [number, number, number];
    readonly psdfile_placeImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly psdfile_preview: (a: number, b: number) => [number, number];
    readonly psdfile_redo: (a: number) => [number, number];
    readonly psdfile_registerFont: (a: number, b: number, c: number, d: number) => [number, number];
    readonly psdfile_render: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly psdfile_sample: (a: number, b: number, c: number, d: number) => [number, number];
    readonly psdfile_save: (a: number) => [number, number, number, number];
    readonly psdfile_select: (a: number, b: number, c: number) => [number, number, number, number];
    readonly psdfile_selectionInfo: (a: number) => [number, number];
    readonly psdfile_summary: (a: number) => [number, number];
    readonly psdfile_thumbnail: (a: number, b: number, c: number) => [number, number];
    readonly psdfile_undo: (a: number) => [number, number];
    readonly psdfile_warnings: (a: number) => [number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
