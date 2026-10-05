/**
 * The `.fig` engine as the app calls it: async methods, workers behind them.
 *
 * Each open file gets a primary worker, which answers queries (layers, hit
 * tests, properties) and renders until helpers are ready, plus raster
 * helpers that open the same file and rasterize tiles in parallel. Workers
 * are terminated when the file is closed, which returns their memory (wasm
 * memory never shrinks while a worker lives).
 */

import type { CollectionInfo, DesignInfo, StyleInfo } from './design-types';
import type {
  Exportable,
  ExportedFile,
  ExportRequest,
  LayoutAids,
} from './handoff-types';
import type {
  LibraryPackage,
  LibrarySpec,
  LibraryStatus,
  LibraryUse,
  PublishedLibrary,
} from './library-types';
import type { FigRequest, FigResponse, QueryMethod } from './protocol';
import type { PrototypeInfo } from './prototype-types';
import type {
  ComponentInfo,
  CopiedLayers,
  EntryChange,
  FileSummary,
  FontUse,
  LayerRow,
  NodeGeometry,
  NodeInfo,
  PageLayout,
  PasteSpec,
  Rect,
  RegisteredFace,
  SearchHit,
  TextGeometry,
  VectorNetwork,
} from './types';

type Ok = Extract<FigResponse, { ok: true }>;
type Body = FigRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

export interface TileRequest {
  page: number;
  /** Page coordinates of the tile's top-left corner. */
  x: number;
  y: number;
  /** Device pixels per page unit. */
  scale: number;
  width: number;
  height: number;
  outline: boolean;
  /** Lower renders first. */
  priority: number;
}

/** What an edit changed (`EditResult` in the engine). */
export interface EditResult {
  created: string[];
  /** Page area whose pixels may have changed. */
  dirty: Rect | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Layers were added, removed, or moved between parents. */
  structure: boolean;
}

export interface TileResult {
  bitmap: ImageBitmap;
  millis: number;
}

/** A queued render that can be cancelled before it starts. */
export interface PendingTile {
  id: number;
  promise: Promise<TileResult | null>;
}

let nextId = 1;

class EngineWorker {
  readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (r: Ok) => void; reject: (e: Error) => void }
  >();
  renders = 0;
  dead = false;

  constructor(onDeath: (error: Error) => void) {
    // Constructed on first use, never at module load: WKWebView deadlocks on
    // eager module workers (apps/web/AGENTS.md).
    this.worker = new Worker(new URL('./fig.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener(
      'message',
      (event: MessageEvent<FigResponse>) => {
        const response = event.data;
        const waiting = this.pending.get(response.id);
        if (!waiting) return;
        this.pending.delete(response.id);
        if (response.ok) waiting.resolve(response);
        else {
          if (response.trapped) this.dead = true;
          waiting.reject(new Error(response.error));
        }
      }
    );
    this.worker.addEventListener('error', (event) => {
      this.dead = true;
      const error = new Error(`fig engine worker failed: ${event.message}`);
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
      onDeath(error);
    });
  }

  request(body: Body, transfer: Transferable[] = []): Promise<Ok> {
    const id = nextId++;
    return this.requestWithId(id, body, transfer);
  }

  requestWithId(id: number, body: Body, transfer: Transferable[] = []) {
    if (this.dead) return Promise.reject(new Error('the file engine stopped'));
    return new Promise<Ok>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id } as FigRequest, transfer);
    });
  }

  cancel(ids: number[]) {
    if (ids.length === 0 || this.dead) return;
    this.worker.postMessage({ id: 0, kind: 'cancel', ids } as FigRequest);
  }

  terminate() {
    this.dead = true;
    this.worker.terminate();
    for (const waiting of this.pending.values())
      waiting.reject(new Error('the file was closed'));
    this.pending.clear();
  }
}

/** Files larger than this get one raster helper (each helper holds a copy). */
const LARGE_FILE_BYTES = 48 * 1024 * 1024;

function helperCount(byteLength: number): number {
  const cores =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const wanted = Math.max(1, Math.min(3, cores - 2));
  return byteLength > LARGE_FILE_BYTES ? 1 : wanted;
}

export class FigEngine {
  private readonly primary: EngineWorker;
  private readonly helpers: EngineWorker[] = [];
  private readonly placed = new Map<number, EngineWorker>();
  private readonly starting = new Set<EngineWorker>();
  private closed = false;
  /** Work (a last save) that keeps the primary worker alive after close. */
  private readonly holds = new Set<Promise<unknown>>();
  private onFailure?: (error: Error) => void;

  private constructor(
    primary: EngineWorker,
    readonly summary: FileSummary
  ) {
    this.primary = primary;
  }

  /** The bytes of a new, empty design (one page). */
  static async blank(name: string): Promise<Uint8Array<ArrayBuffer>> {
    const worker = new EngineWorker(() => {});
    try {
      const r = await worker.request({ kind: 'blank', name });
      if (r.kind !== 'saved') throw new Error('unexpected response');
      return new Uint8Array(r.bytes);
    } finally {
      worker.terminate();
    }
  }

  /** Opens a file. `bytes` is copied to each worker; the caller keeps it. */
  static async open(
    bytes: ArrayBuffer,
    options: { helpers?: number; onFailure?: (error: Error) => void } = {}
  ): Promise<FigEngine> {
    let engine: FigEngine | undefined;
    const primary = new EngineWorker((e) => engine?.onFailure?.(e));
    try {
      const copy = bytes.slice(0);
      const response = await primary.request({ kind: 'open', bytes: copy }, [
        copy,
      ]);
      if (response.kind !== 'open') throw new Error('unexpected response');
      engine = new FigEngine(primary, response.summary);
      engine.onFailure = options.onFailure;
      const helpers = options.helpers ?? helperCount(bytes.byteLength);
      for (let i = 0; i < helpers; i++) engine.startHelper(bytes);
      return engine;
    } catch (error) {
      primary.terminate();
      throw error;
    }
  }

  private startHelper(bytes: ArrayBuffer) {
    const helper = new EngineWorker(() => {
      const at = this.helpers.indexOf(helper);
      if (at >= 0) this.helpers.splice(at, 1);
      this.starting.delete(helper);
    });
    // Edits reach a helper that is still opening through its queue, after
    // the open, so it never misses one.
    this.starting.add(helper);
    const copy = bytes.slice(0);
    helper
      .request({ kind: 'open', bytes: copy }, [copy])
      .then(() => {
        this.starting.delete(helper);
        if (this.closed) helper.terminate();
        else this.helpers.push(helper);
      })
      .catch(() => {
        this.starting.delete(helper);
        helper.terminate();
      });
  }

  private async query<T>(
    method: QueryMethod,
    ...args: (string | number | null)[]
  ): Promise<T> {
    const r = await this.primary.request({ kind: 'query', method, args });
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as T;
  }

  async openPage(page: number): Promise<PageLayout> {
    const r = await this.primary.request({ kind: 'openPage', page });
    if (r.kind !== 'openPage') throw new Error('unexpected response');
    return r.layout;
  }

  /** Queues a tile render on the least busy worker. */
  render(tile: TileRequest): PendingTile {
    const live = this.helpers.filter((h) => !h.dead);
    const pool = live.length > 0 ? live : [this.primary];
    const worker = pool.reduce((a, b) => (b.renders < a.renders ? b : a));
    const id = nextId++;
    worker.renders++;
    this.placed.set(id, worker);
    const promise = worker
      .requestWithId(id, { kind: 'render', ...tile })
      .then((r) => {
        if (r.kind === 'render')
          return { bitmap: r.bitmap, millis: r.millis } satisfies TileResult;
        return null;
      })
      .finally(() => {
        worker.renders--;
        this.placed.delete(id);
      });
    return { id, promise };
  }

  /** Drops queued renders that have not started. */
  cancel(ids: number[]) {
    const byWorker = new Map<EngineWorker, number[]>();
    for (const id of ids) {
      const w = this.placed.get(id);
      if (!w) continue;
      const list = byWorker.get(w) ?? [];
      list.push(id);
      byWorker.set(w, list);
    }
    for (const [w, list] of byWorker) w.cancel(list);
  }

  /** The file's pages and details as they are now (after edits). */
  currentSummary(): Promise<FileSummary> {
    return this.query('summary');
  }

  /** Every component in the file (after edits), for the assets list. */
  components(): Promise<ComponentInfo[]> {
    return this.query('components');
  }

  /** The file's shared styles (after edits). */
  styles(): Promise<StyleInfo[]> {
    return this.query('styles');
  }

  /** The file's variable collections (after edits). */
  variables(): Promise<CollectionInfo[]> {
    return this.query('variables');
  }

  /** A layer's component, variant, property, and style details. */
  designInfo(page: number, id: string): Promise<DesignInfo> {
    return this.query('designInfo', page, id);
  }

  layers(page: number, parent?: string): Promise<LayerRow[]> {
    return this.query('layers', page, parent ?? null);
  }

  rows(page: number, ids: string[]): Promise<LayerRow[]> {
    return this.query('rows', page, JSON.stringify(ids));
  }

  nodeInfo(page: number, id: string): Promise<NodeInfo> {
    return this.query('nodeInfo', page, id);
  }

  /** Layers under a page point, from the page's child to the deepest. */
  hitTest(
    page: number,
    x: number,
    y: number,
    tolerance: number
  ): Promise<LayerRow[]> {
    return this.query('hitTest', page, x, y, tolerance);
  }

  /** Layers from the page's child down to `id`. */
  ancestry(page: number, id: string): Promise<LayerRow[]> {
    return this.query('ancestry', page, id);
  }

  geometry(page: number, ids: string[]): Promise<NodeGeometry[]> {
    return this.query('geometry', page, JSON.stringify(ids));
  }

  outline(page: number, id: string): Promise<string> {
    return this.query('outline', page, id);
  }

  search(page: number, query: string, limit = 200): Promise<SearchHit[]> {
    return this.query('search', page, query, limit);
  }

  /** The page's guides and its frames' layout grids and guides. */
  layoutAids(page: number): Promise<LayoutAids> {
    return this.query('layoutAids', page);
  }

  /** A layer and the layers inside it with export presets. */
  exportables(page: number, id: string): Promise<Exportable[]> {
    return this.query('exportables', page, id);
  }

  /** Layers exported with presets: one file, or a ZIP of several. */
  async exportFiles(
    page: number,
    request: ExportRequest
  ): Promise<ExportedFile> {
    const r = await this.primary.request({
      kind: 'exportFiles',
      page,
      request: JSON.stringify(request),
    });
    if (r.kind !== 'file') throw new Error('nothing to export');
    return {
      name: r.name,
      mime: r.mime,
      blob: new Blob([r.bytes], { type: r.mime }),
    };
  }

  /** "Export frames to PDF": the page's top-level frames, a page each. */
  async exportFramesPdf(page: number): Promise<Blob> {
    const r = await this.primary.request({ kind: 'exportFramesPdf', page });
    if (r.kind !== 'file') throw new Error('nothing to export');
    return new Blob([r.bytes], { type: 'application/pdf' });
  }

  /** The page's flows, screens, and layers with interactions. */
  prototype(page: number): Promise<PrototypeInfo> {
    return this.query('prototype', page);
  }

  /** The page's distinct solid colors, most used first (`RRGGBB[AA]`). */
  pageColors(page: number, limit = 24): Promise<string[]> {
    return this.query('pageColors', page, limit);
  }

  inRect(page: number, parent: string | undefined, rect: Rect) {
    return this.query<string[]>(
      'inRect',
      page,
      parent ?? null,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );
  }

  /** A PNG of one layer at `scale` (transparent background). */
  async exportPng(page: number, id: string, scale: number): Promise<Blob> {
    const r = await this.primary.request({
      kind: 'export',
      page,
      node: id,
      scale,
    });
    if (r.kind !== 'png' || !r.bytes) throw new Error('nothing to export');
    return new Blob([r.bytes], { type: 'image/png' });
  }

  /** One layer (and what it holds) as an SVG document. */
  /** The fonts the document's text uses and whether each is available. */
  fonts(): Promise<FontUse[]> {
    return this.query('fonts');
  }

  /** A text layer's lines and caret stops, for the text editor. */
  textGeometry(page: number, id: string): Promise<TextGeometry | null> {
    return this.query('textGeometry', page, id);
  }

  /**
   * Makes a font available to text layout in every worker (TTF, OTF,
   * WOFF, or WOFF2), as `family` when given. Resolves to the faces the
   * primary worker registered (none when the file is not a font).
   */
  async registerFont(
    bytes: ArrayBuffer,
    family?: string
  ): Promise<RegisteredFace[]> {
    for (const h of [...this.helpers, ...this.starting]) {
      const copy = bytes.slice(0);
      h.request({ kind: 'registerFont', bytes: copy, family: family ?? null }, [
        copy,
      ]).catch(() => {});
    }
    const copy = bytes.slice(0);
    const r = await this.primary.request(
      { kind: 'registerFont', bytes: copy, family: family ?? null },
      [copy]
    );
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as RegisteredFace[];
  }

  exportSvg(page: number, id: string): Promise<string> {
    return this.query('exportSvg', page, id);
  }

  /** A layer's points in page coordinates; `null` for layers without. */
  vectorNetwork(page: number, id: string): Promise<VectorNetwork | null> {
    return this.query('vectorNetwork', page, id);
  }

  /** Copies layers as the clipboard carries them. */
  async copy(page: number, ids: string[]): Promise<CopiedLayers> {
    const r = await this.primary.request({
      kind: 'copy',
      page,
      ids: JSON.stringify(ids),
    });
    if (r.kind !== 'copied') throw new Error('unexpected response');
    return {
      document: new Uint8Array(r.document),
      images: new Uint8Array(r.images),
    };
  }

  /** Pastes copied layers as one step, in every worker. */
  paste(
    page: number,
    copied: CopiedLayers,
    spec: PasteSpec
  ): Promise<EditResult> {
    // Each worker gets its own copy of the bytes (they are transferred).
    return this.edit(() => {
      const document = copied.document.slice().buffer;
      const images =
        copied.images.length > 0 ? copied.images.slice().buffer : null;
      return {
        body: {
          kind: 'paste',
          page,
          document,
          images,
          spec: JSON.stringify(spec),
        },
        transfer: images ? [document, images] : [document],
      };
    });
  }

  /**
   * Applies an edit step on every worker (each holds the document); the
   * primary's answer is returned. A helper that disagrees is dropped.
   */
  private async edit(
    make:
      | Extract<Body, { kind: 'edit' }>
      | (() => {
          body: Extract<Body, { kind: 'paste' | 'importLibrary' }>;
          transfer: Transferable[];
        })
  ): Promise<EditResult> {
    const request = (w: EngineWorker) => {
      if (typeof make !== 'function') return w.request(make);
      const { body, transfer } = make();
      return w.request(body, transfer);
    };
    // Every worker holds the same document, so an edit the engine rejects
    // fails in all of them; a helper is dropped only when its result
    // differs from the primary's.
    const fanned = [...this.helpers, ...this.starting].map((h) => ({
      h,
      done: request(h).then(
        () => true,
        () => false
      ),
    }));
    const drop = (h: EngineWorker) => {
      const at = this.helpers.indexOf(h);
      if (at >= 0) this.helpers.splice(at, 1);
      h.terminate();
    };
    let r: Ok;
    try {
      r = await request(this.primary);
    } catch (error) {
      for (const { h, done } of fanned) void done.then((ok) => ok && drop(h));
      throw error;
    }
    for (const { h, done } of fanned) void done.then((ok) => !ok && drop(h));
    if (r.kind !== 'edit') throw new Error('unexpected response');
    return JSON.parse(r.json) as EditResult;
  }

  /** What publishing the file as a library would change. */
  libraryStatus(): Promise<LibraryStatus> {
    return this.query('libraryStatus');
  }

  /** The file's published library assets. */
  libraryAssets(): Promise<PublishedLibrary> {
    return this.query('libraryAssets');
  }

  /** The libraries the file uses and its copies of their assets. */
  libraryUses(): Promise<LibraryUse> {
    return this.query('libraryUses');
  }

  /** The library assets named by `keys`, with what they use, for another file. */
  async libraryPackage(keys: string[]): Promise<LibraryPackage> {
    const r = await this.primary.request({
      kind: 'libraryPackage',
      keys: JSON.stringify(keys),
    });
    if (r.kind !== 'copied') throw new Error('unexpected response');
    return {
      document: new Uint8Array(r.document),
      images: new Uint8Array(r.images),
    };
  }

  /** Imports a library package as one step, in every worker. */
  importLibrary(
    page: number,
    pkg: LibraryPackage,
    spec: LibrarySpec
  ): Promise<EditResult> {
    return this.edit(() => {
      const document = pkg.document.slice().buffer;
      const images = pkg.images.length > 0 ? pkg.images.slice().buffer : null;
      return {
        body: {
          kind: 'importLibrary',
          page,
          document,
          images,
          spec: JSON.stringify(spec),
        },
        transfer: images ? [document, images] : [document],
      };
    });
  }

  /** A PNG of a layer on any canvas (library copies too); null when empty. */
  async nodeThumbnail(id: string, size: number): Promise<Blob | null> {
    const r = await this.primary.request({
      kind: 'nodeThumbnail',
      node: id,
      size,
    });
    if (r.kind !== 'png' || !r.bytes) return null;
    return new Blob([r.bytes], { type: 'image/png' });
  }

  /** Applies edit operations (see `fig_engine::edit::Op`) as one step. */
  apply(page: number, ops: unknown[], coalesce?: string): Promise<EditResult> {
    return this.edit({
      kind: 'edit',
      page,
      action: 'apply',
      ops: JSON.stringify(ops),
      coalesce,
    });
  }

  undo(page: number): Promise<EditResult> {
    return this.edit({ kind: 'edit', page, action: 'undo' });
  }

  redo(page: number): Promise<EditResult> {
    return this.edit({ kind: 'edit', page, action: 'redo' });
  }

  /**
   * Starts editing together with other people, in every worker: new layers
   * get ids in `session` (unique per person and visit). `baseBlobs` is the
   * shared `figMeta.baseBlobs`, when set. Resolves to changes to write.
   */
  async enableCollab(
    session: number,
    baseBlobs: number | null
  ): Promise<EntryChange[]> {
    for (const h of [...this.helpers, ...this.starting])
      h.request({ kind: 'enableCollab', session, baseBlobs }).catch(() => {});
    const r = await this.primary.request({
      kind: 'enableCollab',
      session,
      baseBlobs,
    });
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as EntryChange[];
  }

  /** The shared-map changes of this person's edits since the last call. */
  async collabChanges(): Promise<EntryChange[]> {
    const r = await this.primary.request({ kind: 'collabChanges' });
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as EntryChange[];
  }

  /** Applies other people's changes in every worker (not undoable here). */
  applyRemote(page: number, changes: EntryChange[]): Promise<EditResult> {
    return this.edit({
      kind: 'edit',
      page,
      action: 'remote',
      changes: JSON.stringify(changes),
    });
  }

  /**
   * Adds an image file (PNG, JPEG, GIF, WebP) for image fills, in every
   * worker; returns its SHA-1 (the paint's reference) and pixel size.
   */
  async addImage(
    bytes: ArrayBuffer
  ): Promise<{ hash: string; width: number; height: number }> {
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    for (const h of [...this.helpers, ...this.starting]) {
      const copy = bytes.slice(0);
      h.request({ kind: 'addImage', hash, bytes: copy }, [copy]).catch(
        () => {}
      );
    }
    const copy = bytes.slice(0);
    const r = await this.primary.request(
      { kind: 'addImage', hash, bytes: copy },
      [copy]
    );
    if (r.kind !== 'query') throw new Error('unexpected response');
    const [width, height] = JSON.parse(r.json) as [number, number];
    return { hash, width, height };
  }

  /** The edited file as `.fig` bytes. */
  async save(): Promise<Uint8Array<ArrayBuffer>> {
    const r = await this.primary.request({ kind: 'save' });
    if (r.kind !== 'saved') throw new Error('unexpected response');
    return new Uint8Array(r.bytes);
  }

  /** Figma's own thumbnail of the file, when it has one. */
  async thumbnail(): Promise<Blob | null> {
    const r = await this.primary.request({ kind: 'thumbnail' });
    if (r.kind !== 'png' || !r.bytes) return null;
    return new Blob([r.bytes], { type: 'image/png' });
  }

  get failed(): boolean {
    return this.primary.dead;
  }

  /**
   * Keeps the file open until `work` settles, even if it is closed first
   * (so the save started when the editor goes away can finish).
   */
  retain(work: Promise<unknown>) {
    this.holds.add(work);
    void work.finally(() => this.holds.delete(work));
  }

  close() {
    this.closed = true;
    const primary = this.primary;
    if (this.holds.size === 0) primary.terminate();
    else
      void Promise.allSettled([...this.holds]).then(() => primary.terminate());
    for (const h of this.helpers) h.terminate();
    for (const h of this.starting) h.terminate();
    this.helpers.length = 0;
    this.starting.clear();
  }
}
