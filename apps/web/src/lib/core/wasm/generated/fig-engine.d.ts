/* tslint:disable */
/* eslint-disable */

/**
 * Copied layers: the `.fig` document and the images ZIP.
 */
export class Clipboard {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly document: Uint8Array;
    readonly images: Uint8Array;
}

/**
 * An exported file.
 */
export class ExportFile {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly name: string;
}

/**
 * An open `.fig` file.
 */
export class FigFile {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds an image for image fills under its SHA-1 (hex); returns
     * `[width, height]` JSON.
     */
    addImage(hash: string, bytes: Uint8Array): string;
    /**
     * Layers from the page's child down to `id` (`LayerRow[]` JSON).
     */
    ancestry(page: number, id: string): string;
    /**
     * Applies edit operations (`Op[]` JSON) as one undoable step. Steps
     * with the same `coalesce` key in a row (one drag) undo together.
     * Returns an `EditResult` JSON.
     */
    apply(page: number, ops: string, coalesce?: string | null): string;
    /**
     * Applies other people's changes (`EntryChange[]` JSON); they do not
     * enter the undo history. Returns an `EditResult` JSON.
     */
    applyCollab(page: number, changes: string): string;
    /**
     * A new, empty design (a `.fig` file with one page).
     */
    static blank(name: string): Uint8Array;
    /**
     * The `EntryChange[]` JSON that brings the shared maps up to date with
     * this person's edits (including undo and redo) since the last call.
     */
    collabChanges(): string;
    /**
     * The file's components, page by page (`ComponentInfo[]` JSON).
     */
    components(): string;
    /**
     * Copies layers (`string[]` JSON of ids) as Figma's clipboard holds
     * them: a `.fig` document and a ZIP of the images they use.
     */
    copy(page: number, ids: string): Clipboard;
    /**
     * Decodes about `nodes` more nodes; returns whether the whole file is
     * decoded.
     */
    decodeSome(nodes: number): boolean;
    /**
     * One layer's component, variant, property, and style details
     * (`DesignInfo` JSON).
     */
    designInfo(page: number, id: string): string;
    /**
     * Starts editing together with other people: new layers get ids in
     * `session` (unique per person and visit), and `baseBlobs` is the
     * shared `figMeta.baseBlobs` when it is set. Returns the
     * `EntryChange[]` JSON to write (the base count when it was not set).
     */
    enableCollab(session: number, base_blobs?: number | null): string;
    /**
     * Exports layers with export presets (`ExportRequest` JSON): one
     * file, or a ZIP of several.
     */
    exportFiles(page: number, request: string): ExportFile;
    /**
     * "Export frames to PDF": the page's top-level frames, a page each.
     */
    exportFramesPdf(page: number): Uint8Array;
    /**
     * A PNG of one layer at `scale`, with a transparent background.
     */
    exportPng(page: number, id: string, scale: number): Uint8Array;
    /**
     * One layer (and what it holds) as an SVG document.
     */
    exportSvg(page: number, id: string): string;
    /**
     * A layer and the layers inside it with export presets
     * (`Exportable[]` JSON).
     */
    exportables(page: number, id: string): string;
    /**
     * The fonts the document's text uses and whether each is available
     * (`FontUse[]` JSON).
     */
    fonts(): string;
    /**
     * Frame corners and bounds of layers (`NodeGeometry[]` JSON).
     */
    geometry(page: number, ids: string): string;
    /**
     * Layers under a page point, from the page's child down to the deepest
     * (`LayerRow[]` JSON).
     */
    hitTest(page: number, x: number, y: number, tolerance: number): string;
    /**
     * Imports a library package (see `libraryPackage`) as one undoable
     * step; `spec` is `LibrarySpec` JSON. Returns an `EditResult` JSON.
     */
    importLibrary(page: number, document: Uint8Array, images: Uint8Array | null | undefined, spec: string): string;
    /**
     * Children of `parent` (the page when absent) whose frames intersect a
     * page rectangle (`string[]` JSON).
     */
    inRect(page: number, parent: string | null | undefined, x: number, y: number, width: number, height: number): string;
    /**
     * Whether the whole file is decoded.
     */
    isComplete(): boolean;
    /**
     * Whether anything was edited since the file was opened.
     */
    isEdited(): boolean;
    /**
     * Children of a layer (the page when `parent` is absent) for the
     * layers panel (`LayerRow[]` JSON).
     */
    layers(page: number, parent?: string | null): string;
    /**
     * The page's guides and its frames' grids and guides (`LayoutAids`
     * JSON).
     */
    layoutAids(page: number): string;
    /**
     * The file's published library assets (`PublishedLibrary` JSON).
     */
    libraryAssets(): string;
    /**
     * The assets named by `keys` (`string[]` JSON) with what they use, for
     * another file to import.
     */
    libraryPackage(keys: string): Clipboard;
    /**
     * What publishing the file as a library would change
     * (`LibraryStatus` JSON).
     */
    libraryStatus(): string;
    /**
     * The libraries the file uses and its copies of their assets
     * (`LibraryUse` JSON).
     */
    libraryUses(): string;
    /**
     * How to move layers (`string[]` JSON of ids) by drawing them apart
     * from the rest of the page while they are dragged (`LiftPlan` JSON;
     * see `inspect::lift_plan`).
     */
    liftPlan(page: number, ids: string): string;
    /**
     * Opens a `.fig` file, decoding what its first page shows.
     */
    constructor(bytes: Uint8Array);
    /**
     * One layer's properties (`NodeInfo` JSON).
     */
    nodeInfo(page: number, id: string): string;
    /**
     * A PNG of a layer on any canvas (library copies included), fitted in
     * `size` pixels; empty when it draws nothing.
     */
    nodeThumbnail(id: string, size: number): Uint8Array;
    /**
     * Expands a page; returns its bounds and frames (`PageLayout` JSON).
     */
    openPage(page: number): string;
    /**
     * SVG path data of a layer's outline in page coordinates.
     */
    outline(page: number, id: string): string;
    /**
     * The distinct solid colors the page uses, most used first
     * (`string[]` JSON of `RRGGBB` or `RRGGBBAA`).
     */
    pageColors(page: number, limit: number): string;
    /**
     * Pastes copied layers (a `.fig` document and, optionally, a ZIP of
     * their images) as one undoable step; `spec` is `PasteSpec` JSON.
     * Returns an `EditResult` JSON.
     */
    paste(page: number, document: Uint8Array, images: Uint8Array | null | undefined, spec: string): string;
    /**
     * The page's flows, screens, and layers with interactions
     * (`PrototypeInfo` JSON).
     */
    prototype(page: number): string;
    redo(page: number): string;
    /**
     * Makes a font available to text layout (TTF, OTF, collection, WOFF,
     * or WOFF2), named `family` when given; returns the faces it holds
     * (`RegisteredFace[]` JSON, empty when the file does not parse). Fonts
     * are shared by every file this worker opens.
     */
    static registerFont(bytes: Uint8Array, family?: string | null): string;
    /**
     * Renders `width × height` device pixels showing the page from
     * `(x, y)` at `scale` pixels per unit, on the page color: RGBA, opaque.
     *
     * `layers` (`LayersSpec` JSON) draws only some layers: what paints in
     * a paint-order window, only some layers (the parts `liftPlan`
     * describes), or all but some. Only some layers, and a window that
     * does not start at the bottom of the page, are drawn on transparency,
     * as straight-alpha RGBA.
     */
    render(page: number, x: number, y: number, scale: number, width: number, height: number, outline: boolean, layers?: string | null): Uint8Array;
    /**
     * Layer rows for several ids (`LayerRow[]` JSON), skipping unknown ids.
     */
    rows(page: number, ids: string): string;
    /**
     * The edited file, as `.fig` bytes.
     */
    save(): Uint8Array;
    /**
     * Layers whose name or text contains `query` (`SearchHit[]` JSON).
     */
    search(page: number, query: string, limit: number): string;
    /**
     * The file's shared styles (`StyleInfo[]` JSON).
     */
    styles(): string;
    /**
     * Pages and file details (`FileSummary` JSON).
     */
    summary(): string;
    /**
     * A text layer's lines and caret stops (`TextGeometry` JSON, `null`
     * for other layers).
     */
    textGeometry(page: number, id: string): string;
    /**
     * Figma's thumbnail of the file, if it has one (PNG).
     */
    thumbnail(): Uint8Array | undefined;
    undo(page: number): string;
    /**
     * The file's variable collections (`CollectionInfo[]` JSON).
     */
    variables(): string;
    /**
     * The points of a layer, in page coordinates, for editing them
     * (`Network` JSON); `undefined` for layers without points.
     */
    vectorNetwork(page: number, id: string): string | undefined;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_clipboard_free: (a: number, b: number) => void;
    readonly __wbg_exportfile_free: (a: number, b: number) => void;
    readonly __wbg_figfile_free: (a: number, b: number) => void;
    readonly clipboard_document: (a: number) => [number, number];
    readonly clipboard_images: (a: number) => [number, number];
    readonly exportfile_bytes: (a: number) => [number, number];
    readonly exportfile_mime: (a: number) => [number, number];
    readonly exportfile_name: (a: number) => [number, number];
    readonly figfile_addImage: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly figfile_ancestry: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_apply: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly figfile_applyCollab: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_blank: (a: number, b: number) => [number, number];
    readonly figfile_collabChanges: (a: number) => [number, number, number, number];
    readonly figfile_components: (a: number) => [number, number, number, number];
    readonly figfile_copy: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly figfile_decodeSome: (a: number, b: number) => [number, number, number];
    readonly figfile_designInfo: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_enableCollab: (a: number, b: number, c: number) => [number, number, number, number];
    readonly figfile_exportFiles: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly figfile_exportFramesPdf: (a: number, b: number) => [number, number, number, number];
    readonly figfile_exportPng: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly figfile_exportSvg: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_exportables: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_fonts: (a: number) => [number, number, number, number];
    readonly figfile_geometry: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_hitTest: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly figfile_importLibrary: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly figfile_inRect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly figfile_isComplete: (a: number) => number;
    readonly figfile_isEdited: (a: number) => number;
    readonly figfile_layers: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_layoutAids: (a: number, b: number) => [number, number, number, number];
    readonly figfile_libraryAssets: (a: number) => [number, number, number, number];
    readonly figfile_libraryPackage: (a: number, b: number, c: number) => [number, number, number];
    readonly figfile_libraryStatus: (a: number) => [number, number, number, number];
    readonly figfile_libraryUses: (a: number) => [number, number, number, number];
    readonly figfile_liftPlan: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_new: (a: number, b: number) => [number, number, number];
    readonly figfile_nodeInfo: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_nodeThumbnail: (a: number, b: number, c: number, d: number) => [number, number];
    readonly figfile_openPage: (a: number, b: number) => [number, number, number, number];
    readonly figfile_outline: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_pageColors: (a: number, b: number, c: number) => [number, number, number, number];
    readonly figfile_paste: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly figfile_prototype: (a: number, b: number) => [number, number, number, number];
    readonly figfile_redo: (a: number, b: number) => [number, number, number, number];
    readonly figfile_registerFont: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_render: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly figfile_rows: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_save: (a: number) => [number, number, number, number];
    readonly figfile_search: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly figfile_styles: (a: number) => [number, number, number, number];
    readonly figfile_summary: (a: number) => [number, number, number, number];
    readonly figfile_textGeometry: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figfile_thumbnail: (a: number) => [number, number];
    readonly figfile_undo: (a: number, b: number) => [number, number, number, number];
    readonly figfile_variables: (a: number) => [number, number, number, number];
    readonly figfile_vectorNetwork: (a: number, b: number, c: number, d: number) => [number, number, number, number];
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
