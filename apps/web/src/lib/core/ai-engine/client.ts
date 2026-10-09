/**
 * The Illustrator engine as the app calls it: async methods, workers behind
 * them.
 *
 * Each open document gets a primary worker, which answers queries (layers,
 * hit tests, properties) and renders until helpers are ready, plus raster
 * helpers that open the same file and rasterize tiles in parallel. Every
 * worker holds the document, so edits apply in all of them. Workers are
 * terminated when the document is closed, which returns their memory (wasm
 * memory never shrinks while a worker lives).
 */

import type { AiRequest, AiResponse, QueryMethod } from './protocol';
import type {
  EdgeRect,
  EditResult,
  EntryChange,
  FontUse,
  Info,
  Op,
  RegisteredFace,
  Row,
  Summary,
  TextGeometry,
} from './types';

type Ok = Extract<AiResponse, { ok: true }>;
type Body = AiRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

/** A tile to rasterize (the tile compositor's request). */
export interface TileRequest {
  /** Canvas coordinates of the tile's top-left corner. */
  x: number;
  y: number;
  /** Device pixels per canvas unit. */
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

/** Whether a request succeeded. */
async function succeeded(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch {
    return false;
  }
}

/** A helper's copy of a request nobody waits for. */
async function ignore(request: Promise<unknown>): Promise<void> {
  try {
    await request;
  } catch {
    // A helper that fails is dropped by the next edit it disagrees on.
  }
}

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
    this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener(
      'message',
      (event: MessageEvent<AiResponse>) => {
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
      const error = new Error(`ai engine worker failed: ${event.message}`);
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
      onDeath(error);
    });
  }

  request(body: Body, transfer: Transferable[] = []): Promise<Ok> {
    return this.requestWithId(nextId++, body, transfer);
  }

  requestWithId(id: number, body: Body, transfer: Transferable[] = []) {
    if (this.dead) return Promise.reject(new Error('the file engine stopped'));
    return new Promise<Ok>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id } as AiRequest, transfer);
    });
  }

  cancel(ids: number[]) {
    if (ids.length === 0 || this.dead) return;
    this.worker.postMessage({ id: 0, kind: 'cancel', ids } as AiRequest);
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

export class AiEngine {
  private readonly primary: EngineWorker;
  private readonly helpers: EngineWorker[] = [];
  private readonly placed = new Map<number, EngineWorker>();
  private readonly starting = new Set<EngineWorker>();
  private closed = false;
  /** Work (a last save) that keeps the primary worker alive after close. */
  private readonly holds = new Set<Promise<unknown>>();
  private onFailure?: (error: Error) => void;
  /** The pasteboard color tiles are drawn on (0–255 RGB). */
  private background: [number, number, number] = [228, 228, 228];

  private constructor(
    primary: EngineWorker,
    /** The document as it was opened. */
    readonly summary: Summary,
    /** What could not be read faithfully. */
    readonly warnings: string[]
  ) {
    this.primary = primary;
  }

  /** The bytes of a new document: one artboard of `width × height` points. */
  static async blank(
    width: number,
    height: number
  ): Promise<Uint8Array<ArrayBuffer>> {
    const worker = new EngineWorker(() => {});
    try {
      const r = await worker.request({ kind: 'blank', width, height });
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
  ): Promise<AiEngine> {
    let engine: AiEngine | undefined;
    const primary = new EngineWorker((e) => engine?.onFailure?.(e));
    try {
      const copy = bytes.slice(0);
      const response = await primary.request({ kind: 'open', bytes: copy }, [
        copy,
      ]);
      if (response.kind !== 'open') throw new Error('unexpected response');
      engine = new AiEngine(primary, response.summary, response.warnings);
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
    const start = async () => {
      try {
        await helper.request({ kind: 'open', bytes: copy }, [copy]);
        this.starting.delete(helper);
        if (this.closed) helper.terminate();
        else this.helpers.push(helper);
      } catch {
        this.starting.delete(helper);
        helper.terminate();
      }
    };
    void start();
  }

  /** Every worker besides the primary, opened or still opening. */
  private others(): EngineWorker[] {
    return [...this.helpers, ...this.starting];
  }

  private async query<T>(
    method: QueryMethod,
    ...args: (string | number | boolean | null)[]
  ): Promise<T> {
    const r = await this.primary.request({ kind: 'query', method, args });
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as T;
  }

  /** Sets the pasteboard color of the tiles rendered from now on. */
  setBackground(rgb: [number, number, number]) {
    this.background = rgb;
  }

  /** Queues a tile render on the least busy worker. */
  render(tile: TileRequest): PendingTile {
    const live = this.helpers.filter((h) => !h.dead);
    const pool = live.length > 0 ? live : [this.primary];
    const worker = pool.reduce((a, b) => (b.renders < a.renders ? b : a));
    const id = nextId++;
    worker.renders++;
    this.placed.set(id, worker);
    const run = async (): Promise<TileResult | null> => {
      try {
        const r = await worker.requestWithId(id, {
          kind: 'render',
          x: tile.x,
          y: tile.y,
          scale: tile.scale,
          width: tile.width,
          height: tile.height,
          outline: tile.outline,
          background: this.background,
          priority: tile.priority,
        });
        return r.kind === 'render'
          ? { bitmap: r.bitmap, millis: r.millis }
          : null;
      } finally {
        worker.renders--;
        this.placed.delete(id);
      }
    };
    return { id, promise: run() };
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

  /** The document's artboards and details as they are now (after edits). */
  currentSummary(): Promise<Summary> {
    return this.query('summary');
  }

  /** The layers panel, top to bottom. */
  rows(): Promise<Row[]> {
    return this.query('rows');
  }

  /** One node's properties (`null` when it is gone). */
  info(id: number): Promise<Info | null> {
    return this.query('info', id);
  }

  /** Several nodes' properties at once, in order. */
  infos(ids: number[]): Promise<(Info | null)[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.query('infos', JSON.stringify(ids));
  }

  /**
   * The topmost object at a canvas point: the object itself (`deep`) or
   * the outermost group holding it. `scale` is pixels per canvas unit.
   */
  hitTest(
    x: number,
    y: number,
    scale: number,
    deep: boolean
  ): Promise<number | null> {
    return this.query('hitTest', x, y, scale, deep);
  }

  /** The objects a canvas rectangle touches. */
  inRect(rect: EdgeRect, deep: boolean): Promise<number[]> {
    return this.query(
      'inRect',
      rect.x0,
      rect.y0,
      rect.x1 - rect.x0,
      rect.y1 - rect.y0,
      deep
    );
  }

  /** The canvas bounds of nodes together. */
  bounds(ids: number[]): Promise<EdgeRect | null> {
    return this.query('bounds', JSON.stringify(ids));
  }

  /** The fonts the document's text uses. */
  fonts(): Promise<FontUse[]> {
    return this.query('fonts');
  }

  /** A text object's lines and caret stops (`null` for other nodes). */
  textGeometry(id: number): Promise<TextGeometry | null> {
    return this.query('textGeometry', id);
  }

  /** The document described for search and agents. */
  describe(): Promise<string> {
    return this.query('describe');
  }

  /** Whether anything was edited since the file was opened. */
  isEdited(): Promise<boolean> {
    return this.query('isEdited');
  }

  /** One node alone as PNG, fitted in `size` pixels (null when empty). */
  async thumbnail(id: number, size: number): Promise<Blob | null> {
    const r = await this.primary.request({ kind: 'thumbnail', node: id, size });
    if (r.kind !== 'png' || !r.bytes) return null;
    return new Blob([r.bytes], { type: 'image/png' });
  }

  /**
   * An artboard (or the whole canvas) as PNG at `scale` pixels per point,
   * over white unless `transparent`.
   */
  async exportPng(
    artboard: number | null,
    scale: number,
    transparent: boolean
  ): Promise<Blob> {
    const r = await this.primary.request({
      kind: 'exportPng',
      artboard,
      scale,
      transparent,
    });
    if (r.kind !== 'png' || !r.bytes) throw new Error('nothing to export');
    return new Blob([r.bytes], { type: 'image/png' });
  }

  /**
   * Applies an edit step on every worker (each holds the document); the
   * primary's answer is returned. A helper that disagrees is dropped.
   */
  private async edit(
    make: () => { body: Body; transfer: Transferable[] }
  ): Promise<EditResult> {
    const request = (w: EngineWorker) => {
      const { body, transfer } = make();
      return w.request(body, transfer);
    };
    // Every worker holds the same document, so an edit the engine rejects
    // fails in all of them; a helper is dropped only when its result
    // differs from the primary's.
    const fanned = this.others().map((h) => ({
      h,
      done: succeeded(request(h)),
    }));
    let r: Ok;
    try {
      r = await request(this.primary);
    } catch (error) {
      for (const { h, done } of fanned) void this.dropIf(h, done, true);
      throw error;
    }
    for (const { h, done } of fanned) void this.dropIf(h, done, false);
    if (r.kind !== 'edit') throw new Error('unexpected response');
    return JSON.parse(r.json) as EditResult;
  }

  /** Drops a helper whose edit ended unlike the primary's. */
  private async dropIf(h: EngineWorker, done: Promise<boolean>, ok: boolean) {
    if ((await done) !== ok) return;
    const at = this.helpers.indexOf(h);
    if (at >= 0) this.helpers.splice(at, 1);
    h.terminate();
  }

  /** Applies edit operations (see `ai_engine::edit::Op`) as one step. */
  apply(ops: Op[], coalesce?: string): Promise<EditResult> {
    const json = JSON.stringify(ops);
    return this.edit(() => ({
      body: { kind: 'edit', action: 'apply', ops: json, coalesce },
      transfer: [],
    }));
  }

  undo(): Promise<EditResult> {
    return this.edit(() => ({
      body: { kind: 'edit', action: 'undo' },
      transfer: [],
    }));
  }

  redo(): Promise<EditResult> {
    return this.edit(() => ({
      body: { kind: 'edit', action: 'redo' },
      transfer: [],
    }));
  }

  /** Applies other people's changes in every worker (not undoable here). */
  applyRemote(changes: EntryChange[]): Promise<EditResult> {
    const json = JSON.stringify(changes);
    return this.edit(() => ({
      body: { kind: 'edit', action: 'remote', changes: json },
      transfer: [],
    }));
  }

  /**
   * Places an image file (PNG, JPEG, GIF, WebP) filling a canvas rectangle
   * (its pixel size at its corner when `w` is zero), as one step.
   */
  placeImage(
    bytes: ArrayBuffer,
    name: string,
    rect: { x: number; y: number; w: number; h: number },
    parent?: number
  ): Promise<EditResult> {
    return this.edit(() => {
      const copy = bytes.slice(0);
      return {
        body: {
          kind: 'placeImage',
          bytes: copy,
          name,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          parent: parent ?? null,
        },
        transfer: [copy],
      };
    });
  }

  /**
   * Starts editing together with other people, in every worker: new
   * objects get ids in `session` (1–4095, unique among the people
   * editing). `seed` asks for the document's state (the first person in a
   * new shared document). Resolves to changes to write.
   */
  async enableCollab(session: number, seed: boolean): Promise<EntryChange[]> {
    for (const h of this.others())
      void ignore(h.request({ kind: 'enableCollab', session, seed }));
    const r = await this.primary.request({
      kind: 'enableCollab',
      session,
      seed,
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

  /**
   * Makes a font available to text layout in every worker (TTF, OTF,
   * WOFF, or WOFF2), as `family` when given. Resolves to the faces the
   * primary worker registered (none when the file is not a font).
   */
  async registerFont(
    bytes: ArrayBuffer,
    family?: string
  ): Promise<RegisteredFace[]> {
    for (const h of this.others()) {
      const copy = bytes.slice(0);
      void ignore(
        h.request(
          { kind: 'registerFont', bytes: copy, family: family ?? null },
          [copy]
        )
      );
    }
    const copy = bytes.slice(0);
    const r = await this.primary.request(
      { kind: 'registerFont', bytes: copy, family: family ?? null },
      [copy]
    );
    if (r.kind !== 'query') throw new Error('unexpected response');
    return JSON.parse(r.json) as RegisteredFace[];
  }

  /** The edited document as `.ai` (PDF) bytes. */
  async save(): Promise<Uint8Array<ArrayBuffer>> {
    const r = await this.primary.request({ kind: 'save' });
    if (r.kind !== 'saved') throw new Error('unexpected response');
    return new Uint8Array(r.bytes);
  }

  get failed(): boolean {
    return this.primary.dead;
  }

  /**
   * Keeps the document open until `work` settles, even if it is closed
   * first (so the save started when the editor goes away can finish).
   */
  retain(work: Promise<unknown>) {
    this.holds.add(work);
    void this.release(work);
  }

  private async release(work: Promise<unknown>) {
    await succeeded(work);
    this.holds.delete(work);
  }

  /** Ends the primary worker once the work it holds settles. */
  private async terminateWhenFree(primary: EngineWorker) {
    await Promise.allSettled([...this.holds]);
    primary.terminate();
  }

  close() {
    this.closed = true;
    const primary = this.primary;
    if (this.holds.size === 0) primary.terminate();
    else void this.terminateWhenFree(primary);
    for (const h of this.helpers) h.terminate();
    for (const h of this.starting) h.terminate();
    this.helpers.length = 0;
    this.starting.clear();
  }
}
