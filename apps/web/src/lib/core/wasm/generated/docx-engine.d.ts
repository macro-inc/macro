/* tslint:disable */
/* eslint-disable */

/**
 * An open document with its editing session.
 */
export class DocxDocument {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies a JSON array of operations; returns the `EditResult` JSON.
     * Batches with the same `group` merge into one undo step (typing).
     */
    apply(ops: string, group?: string | null): string;
    /**
     * Applies other peers' changes (`RemoteChange[]` JSON); returns the
     * `EditResult` JSON.
     */
    applyRemote(changes: string): string;
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
     * The caret rectangle for a position (`CaretRect` JSON or `null`).
     */
    caretAt(pos: string): string;
    /**
     * The shared state of the document (`CollabState` JSON).
     */
    collabState(): string;
    /**
     * The selection for the clipboard (`Clip` JSON: paragraphs, HTML, text).
     */
    copySelection(): string;
    /**
     * The comments stored in the document, Word's (`DocComment[]` JSON).
     */
    documentComments(): string;
    /**
     * The matches of a search in the body (`FindResult` JSON); `options`
     * is `FindOptions` JSON.
     */
    find(query: string, options: string): string;
    /**
     * Opens the document shared state describes (`CollabState` JSON).
     * `seed` makes this peer's new ids unique.
     */
    static fromCollab(state: string, seed: number): DocxDocument;
    /**
     * Opens a document stored in the first shared format (`V1State` JSON).
     */
    static fromV1(state: string): DocxDocument;
    /**
     * The position at a point on a page (`Pos` JSON or `null`).
     */
    hitTest(page: number, x: number, y: number): string;
    /**
     * Font families the document asked for that are not available (JSON array).
     */
    missingFonts(): string;
    /**
     * Opens a `.docx` file.
     */
    constructor(bytes: Uint8Array);
    /**
     * Pages with sizes and fingerprints (`PageInfo[]` JSON).
     */
    pages(): string;
    /**
     * Paragraph ids and texts in document order (`ParagraphText[]` JSON).
     */
    paragraphs(): string;
    /**
     * Highlight rectangles between two positions (`PageRect[]` JSON).
     */
    rangeRects(from: string, to: string): string;
    /**
     * Redoes one step.
     */
    redo(): string | undefined;
    /**
     * Renders a page; returns straight-alpha RGBA rows (`width × height × 4`).
     */
    render(page: number, width: number): Uint8Array;
    /**
     * Renders a strip of a page (`top..bottom` in points) at the page width
     * `width`; returns straight-alpha RGBA rows.
     */
    renderBand(page: number, width: number, top: number, bottom: number): Uint8Array;
    /**
     * Serializes the current state to `.docx` bytes.
     */
    save(): Uint8Array;
    /**
     * The selected text, for the clipboard.
     */
    selectedText(): string;
    /**
     * The name tracked changes are recorded under.
     */
    setAuthor(author: string): void;
    /**
     * Leaves undo history to the caller (the shared document's).
     */
    setExternalUndo(external: boolean): void;
    /**
     * Shows tracked changes inline (`true`) or the final text; returns the
     * `EditResult` JSON.
     */
    setMarkup(markup: boolean): string;
    /**
     * The selection, its geometry and the pages (`EditResult` JSON).
     */
    state(): string;
    /**
     * Paragraph styles for the style picker (JSON).
     */
    styles(): string;
    /**
     * Undoes one step (`EditResult` JSON), or `None` when there is none.
     */
    undo(): string | undefined;
}

export function registerFont(bytes: Uint8Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_docxdocument_free: (a: number, b: number) => void;
    readonly docxdocument_apply: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly docxdocument_applyRemote: (a: number, b: number, c: number) => [number, number, number, number];
    readonly docxdocument_breakGroup: (a: number) => void;
    readonly docxdocument_canRedo: (a: number) => number;
    readonly docxdocument_canUndo: (a: number) => number;
    readonly docxdocument_caretAt: (a: number, b: number, c: number) => [number, number, number, number];
    readonly docxdocument_collabState: (a: number) => [number, number, number, number];
    readonly docxdocument_copySelection: (a: number) => [number, number, number, number];
    readonly docxdocument_documentComments: (a: number) => [number, number, number, number];
    readonly docxdocument_find: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly docxdocument_fromCollab: (a: number, b: number, c: number) => [number, number, number];
    readonly docxdocument_fromV1: (a: number, b: number) => [number, number, number];
    readonly docxdocument_hitTest: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly docxdocument_missingFonts: (a: number) => [number, number, number, number];
    readonly docxdocument_new: (a: number, b: number) => [number, number, number];
    readonly docxdocument_pages: (a: number) => [number, number, number, number];
    readonly docxdocument_paragraphs: (a: number) => [number, number, number, number];
    readonly docxdocument_rangeRects: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly docxdocument_redo: (a: number) => [number, number, number, number];
    readonly docxdocument_render: (a: number, b: number, c: number) => [number, number, number, number];
    readonly docxdocument_renderBand: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly docxdocument_save: (a: number) => [number, number, number, number];
    readonly docxdocument_selectedText: (a: number) => [number, number];
    readonly docxdocument_setAuthor: (a: number, b: number, c: number) => void;
    readonly docxdocument_setExternalUndo: (a: number, b: number) => void;
    readonly docxdocument_setMarkup: (a: number, b: number) => [number, number, number, number];
    readonly docxdocument_state: (a: number) => [number, number, number, number];
    readonly docxdocument_styles: (a: number) => [number, number, number, number];
    readonly docxdocument_undo: (a: number) => [number, number, number, number];
    readonly registerFont: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
