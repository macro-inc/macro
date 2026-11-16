/* tslint:disable */
/* eslint-disable */

/**
 * An open presentation with undo history.
 *
 * Reads that take a slide `index` (outlines, rendering, text layout,
 * copying shapes) also take the id of a slide master or layout (always at
 * least 2147483648) in its place, for Slide Master view.
 */
export class PptxDocument {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies a JSON array of edit operations atomically; returns the `EditResult` as JSON.
     *
     * Batches with the same `group` merge into one undo step (typing).
     */
    apply(ops: string, group?: string | null): string;
    /**
     * Applies entry changes from the shared maps (other peers, undo, redo);
     * returns the `EditResult` as JSON.
     */
    applyCollab(changes: string): string;
    /**
     * Ends the current typing group.
     */
    breakGroup(): void;
    /**
     * Whether redo is possible.
     */
    canRedo(): boolean;
    /**
     * Whether undo is possible.
     */
    canUndo(): boolean;
    /**
     * Entry changes the shared maps need after local edits since the last
     * call (JSON `EntryChange[]`).
     */
    collabChanges(): string;
    /**
     * Copies shapes of slide `index` (`ids`: JSON array of shape ids) as a
     * clipboard payload (JSON) for the `pasteShapes` operation.
     */
    copyShapes(index: number, ids: string): string;
    /**
     * Copies slides (`ids`: JSON array of slide ids) with their notes as a
     * clipboard payload (JSON) for the `pasteSlides` operation.
     */
    copySlides(ids: string): string;
    /**
     * Starts collaborative editing of a file opened with the constructor;
     * the next `collabChanges` describes the whole presentation.
     */
    enableCollab(seed: number): void;
    /**
     * Finds text in every slide (`options`: `FindOptions` JSON); returns
     * `TextMatch[]` JSON.
     */
    findText(query: string, options: string): string;
    /**
     * Opens the presentation that shared collaborative entries describe
     * (`Entries` JSON). `seed` makes this peer's new names and ids unique.
     */
    static fromEntries(entries: string, seed: number): PptxDocument;
    /**
     * A shape's outline as editable paths in shape-local points, with its
     * shape-local → slide transform, as JSON (`ShapeGeometryInfo`, or
     * `null` for groups and graphic frames). For Edit Points.
     */
    geometryPaths(index: number, shape: number): string;
    /**
     * A slide's clickable areas as JSON (`LinkRegion[]`): linked text, then
     * linked shapes.
     */
    linkRegions(index: number): string;
    /**
     * The bytes of a video or audio clip (`MediaOutline.part`).
     */
    mediaBytes(part: string): Uint8Array;
    /**
     * Font families the document asked for that are not available (JSON array).
     */
    missingFonts(): string;
    /**
     * Opens a `.pptx` file.
     */
    constructor(bytes: Uint8Array);
    /**
     * The deck outline as JSON (`DeckOutline`).
     */
    outline(): string;
    /**
     * Redoes one step.
     */
    redo(): string | undefined;
    /**
     * Renders a slide; returns straight-alpha RGBA rows (`width × height × 4` bytes).
     */
    render(index: number, width: number): Uint8Array;
    /**
     * Renders one layer of a slide: `mode` is `"without"` (everything except
     * the shape) or `"only"` (the shape alone over transparency).
     */
    renderLayer(index: number, width: number, mode: string, shape: number): Uint8Array;
    /**
     * Renders the top-level slide shapes at z-order positions `start..end`
     * (see `Layer::Span`), over the background and inherited shapes when
     * `backdrop`.
     */
    renderSpan(index: number, width: number, start: number, end: number, backdrop: boolean): Uint8Array;
    /**
     * Serializes the current state to `.pptx` bytes.
     */
    save(): Uint8Array;
    /**
     * Number of slides.
     */
    slideCount(): number;
    /**
     * One slide's outline as JSON (`SlideOutline`).
     */
    slideOutline(index: number): string;
    /**
     * Slide size in points, `[width, height]`.
     */
    slideSize(): Float64Array;
    /**
     * Lays out a shape's text for carets as JSON (`TextLayoutInfo`, or `null`);
     * with `row` and `col`, the text of that table cell.
     */
    textLayout(index: number, shape: number, row?: number | null, col?: number | null): string;
    /**
     * Undoes one step; returns the `EditResult` JSON, or `None` when there is nothing to undo.
     */
    undo(): string | undefined;
}

/**
 * A preset shape's outline at `w`×`h` points as JSON `[{d, fill, stroke}]`
 * (SVG path data), or `null` for an unknown preset. For shape galleries.
 */
export function presetPaths(name: string, w: number, h: number): string;

/**
 * Registers an extra font file (TTF, OTF, or TTC) for every document.
 */
export function registerFont(bytes: Uint8Array): number;

/**
 * Renders an equation written in the LaTeX-style linear format as a PNG,
 * for the equation editor's preview and galleries: `size` in points,
 * `scale` pixels per point, `color` as `RRGGBB`; empty slots show as
 * dotted boxes. Fails with what is wrong with the linear text.
 */
export function renderEquation(latex: string, display: boolean, size: number, scale: number, color: string): Uint8Array;

/**
 * The SmartArt layouts, color variations, and styles the galleries list,
 * as JSON `{layouts, colors, styles}`.
 */
export function smartArtCatalog(): string;

/**
 * A SmartArt gallery preview as JSON `[{d, fill, fillOpacity, stroke,
 * strokeWidth}]` (SVG paths), or `null` for an unknown layout. `spec` is
 * JSON `{layout, colors?, style?, width, height, theme?}`.
 */
export function smartArtPreview(spec: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_pptxdocument_free: (a: number, b: number) => void;
    readonly pptxdocument_apply: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly pptxdocument_applyCollab: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pptxdocument_breakGroup: (a: number) => void;
    readonly pptxdocument_canRedo: (a: number) => number;
    readonly pptxdocument_canUndo: (a: number) => number;
    readonly pptxdocument_collabChanges: (a: number) => [number, number, number, number];
    readonly pptxdocument_copyShapes: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly pptxdocument_copySlides: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pptxdocument_enableCollab: (a: number, b: number) => void;
    readonly pptxdocument_findText: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly pptxdocument_fromEntries: (a: number, b: number, c: number) => [number, number, number];
    readonly pptxdocument_geometryPaths: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pptxdocument_linkRegions: (a: number, b: number) => [number, number, number, number];
    readonly pptxdocument_mediaBytes: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pptxdocument_missingFonts: (a: number) => [number, number, number, number];
    readonly pptxdocument_new: (a: number, b: number) => [number, number, number];
    readonly pptxdocument_outline: (a: number) => [number, number, number, number];
    readonly pptxdocument_redo: (a: number) => [number, number, number, number];
    readonly pptxdocument_render: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pptxdocument_renderLayer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly pptxdocument_renderSpan: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly pptxdocument_save: (a: number) => [number, number, number, number];
    readonly pptxdocument_slideCount: (a: number) => number;
    readonly pptxdocument_slideOutline: (a: number, b: number) => [number, number, number, number];
    readonly pptxdocument_slideSize: (a: number) => [number, number];
    readonly pptxdocument_textLayout: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly pptxdocument_undo: (a: number) => [number, number, number, number];
    readonly presetPaths: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly registerFont: (a: number, b: number) => number;
    readonly renderEquation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly smartArtCatalog: () => [number, number, number, number];
    readonly smartArtPreview: (a: number, b: number) => [number, number, number, number];
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
