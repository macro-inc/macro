/**
 * The `.fig` engine as the app calls it: async methods, workers behind them.
 *
 * Each open file gets a primary worker, which answers queries (layers, hit
 * tests, properties) and renders until helpers are ready, plus raster
 * helpers that open the same file and rasterize tiles in parallel. Workers
 * are terminated when the file is closed, which returns their memory (wasm
 * memory never shrinks while a worker lives).
 */

import type { FigRequest, FigResponse, QueryMethod } from './protocol';
import type {
  FileSummary,
  LayerRow,
  NodeGeometry,
  NodeInfo,
  PageLayout,
  Rect,
  SearchHit,
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
  private closed = false;
  private onFailure?: (error: Error) => void;

  private constructor(
    primary: EngineWorker,
    readonly summary: FileSummary
  ) {
    this.primary = primary;
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
    });
    const copy = bytes.slice(0);
    helper
      .request({ kind: 'open', bytes: copy }, [copy])
      .then(() => {
        if (this.closed) helper.terminate();
        else this.helpers.push(helper);
      })
      .catch(() => helper.terminate());
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

  /** Figma's own thumbnail of the file, when it has one. */
  async thumbnail(): Promise<Blob | null> {
    const r = await this.primary.request({ kind: 'thumbnail' });
    if (r.kind !== 'png' || !r.bytes) return null;
    return new Blob([r.bytes], { type: 'image/png' });
  }

  get failed(): boolean {
    return this.primary.dead;
  }

  close() {
    this.closed = true;
    this.primary.terminate();
    for (const h of this.helpers) h.terminate();
    this.helpers.length = 0;
  }
}
