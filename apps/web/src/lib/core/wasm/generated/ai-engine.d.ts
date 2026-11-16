/* tslint:disable */
/* eslint-disable */

/**
 * An open Illustrator document.
 */
export class AiFile {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies operations (`Op[]` JSON) as one undoable step; steps with
     * the same `coalesce` key in a row undo together. Returns an
     * `EditResult` JSON.
     */
    apply(ops: string, coalesce?: string | null): string;
    /**
     * Applies other people's entry changes (`EntryChange[]` JSON);
     * returns an `EditResult` JSON of what changed.
     */
    applyCollab(changes: string): string;
    /**
     * A new document's file: one artboard of `width × height` points.
     */
    static blank(width: number, height: number): Uint8Array;
    /**
     * The canvas bounds of nodes together (`Rect` JSON or `null`).
     */
    bounds(ids: string): string;
    /**
     * The entry changes since the last call (`EntryChange[]` JSON).
     */
    collabChanges(): string;
    /**
     * The document described for search and agents.
     */
    describe(): string;
    /**
     * Starts editing together: new nodes get ids in `session`
     * (`1..=4095`), and `seed` asks for the document's state (the first
     * person in a new shared document). Returns `EntryChange[]` JSON to
     * write.
     */
    enableCollab(session: number, seed: boolean): string;
    /**
     * An artboard (or the whole canvas) as PNG at `scale` pixels per
     * point, over white unless `transparent`.
     */
    exportPng(artboard: number | null | undefined, scale: number, transparent: boolean): Uint8Array;
    /**
     * Fonts text objects use (`FontUse[]` JSON).
     */
    fonts(): string;
    /**
     * The topmost object at canvas `(x, y)`: the object itself (`deep`)
     * or the outermost group holding it. `scale` is the view's pixels per
     * unit.
     */
    hitTest(x: number, y: number, scale: number, deep: boolean): number | undefined;
    /**
     * The objects a canvas rectangle touches (`number[]` JSON).
     */
    inRect(x: number, y: number, w: number, h: number, deep: boolean): string;
    /**
     * One node's properties (`Info` JSON, `null` when unknown).
     */
    info(id: number): string;
    /**
     * Whether anything was edited since the file was opened.
     */
    isEdited(): boolean;
    /**
     * Opens an `.ai` (or `.pdf`) file.
     */
    constructor(bytes: Uint8Array);
    /**
     * Places an image (PNG, JPEG, GIF, or WebP) filling a canvas
     * rectangle (its pixel size at `(x, y)` when `w` is zero); returns an
     * `EditResult` JSON.
     */
    placeImage(bytes: Uint8Array, name: string, x: number, y: number, w: number, h: number, parent?: number | null): string;
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
     * Draws `width × height` pixels of the canvas from `(x, y)` (canvas
     * units) at `scale` pixels per unit; straight RGBA. `artboards` fills
     * artboards white; `outline` draws paths as thin lines.
     */
    render(x: number, y: number, scale: number, width: number, height: number, artboards: boolean, outline: boolean): Uint8Array;
    /**
     * The layers panel, top to bottom (`Row[]` JSON).
     */
    rows(): string;
    /**
     * The edited file, as `.ai` (PDF) bytes.
     */
    save(): Uint8Array;
    /**
     * The document's summary (`Summary` JSON).
     */
    summary(): string;
    /**
     * A text object's lines and caret stops for the type tool
     * (`TextGeometry` JSON, `null` for other nodes).
     */
    textGeometry(id: number): string;
    /**
     * The character index nearest a canvas point in a text object.
     */
    textHit(id: number, x: number, y: number): number | undefined;
    /**
     * One node alone, fitted in `size` pixels (PNG; empty when it draws
     * nothing).
     */
    thumbnail(id: number, size: number): Uint8Array;
    /**
     * Undoes the last step (`EditResult` JSON).
     */
    undo(): string;
    /**
     * What could not be read faithfully (`string[]` JSON).
     */
    warnings(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_aifile_free: (a: number, b: number) => void;
    readonly aifile_apply: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly aifile_applyCollab: (a: number, b: number, c: number) => [number, number, number, number];
    readonly aifile_blank: (a: number, b: number) => [number, number, number, number];
    readonly aifile_bounds: (a: number, b: number, c: number) => [number, number];
    readonly aifile_collabChanges: (a: number) => [number, number];
    readonly aifile_describe: (a: number) => [number, number];
    readonly aifile_enableCollab: (a: number, b: number, c: number) => [number, number];
    readonly aifile_exportPng: (a: number, b: number, c: number, d: number) => [number, number];
    readonly aifile_fonts: (a: number) => [number, number];
    readonly aifile_hitTest: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly aifile_inRect: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly aifile_info: (a: number, b: number) => [number, number];
    readonly aifile_isEdited: (a: number) => number;
    readonly aifile_new: (a: number, b: number) => [number, number, number];
    readonly aifile_placeImage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly aifile_redo: (a: number) => [number, number];
    readonly aifile_registerFont: (a: number, b: number, c: number, d: number) => [number, number];
    readonly aifile_render: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly aifile_rows: (a: number) => [number, number];
    readonly aifile_save: (a: number) => [number, number, number, number];
    readonly aifile_summary: (a: number) => [number, number];
    readonly aifile_textGeometry: (a: number, b: number) => [number, number];
    readonly aifile_textHit: (a: number, b: number, c: number, d: number) => number;
    readonly aifile_thumbnail: (a: number, b: number, c: number) => [number, number];
    readonly aifile_undo: (a: number) => [number, number];
    readonly aifile_warnings: (a: number) => [number, number];
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
