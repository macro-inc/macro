/**
 * The Photoshop engine as the app calls it: async methods, a worker behind
 * them.
 *
 * Each open document gets one worker, which holds the document, its undo
 * history, this person's selection, and (when editing together) the
 * shared-map state. The worker is terminated when the document is closed,
 * which returns its memory (wasm memory never shrinks while a worker
 * lives).
 */

import type {
  BytesMethod,
  PsdRequest,
  PsdResponse,
  QueryMethod,
} from './protocol';
import type {
  EditResult,
  EntryChange,
  FontUse,
  LayerInfo,
  LayerRow,
  Op,
  RegisteredFace,
  SelectionInfo,
  SelectSpec,
  Summary,
} from './types';

type Ok = Extract<PsdResponse, { ok: true }>;
type Body = PsdRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

/** A tile to composite: pixels of the canvas scaled by `1/2^level`. */
export interface TileRequest {
  x: number;
  y: number;
  level: number;
  width: number;
  height: number;
  /** Lower renders first. */
  priority: number;
}

export interface TileResult {
  /** `null` for an empty area. */
  bitmap: ImageBitmap | null;
  millis: number;
}

/** A queued render that can be cancelled before it starts. */
export interface PendingTile {
  id: number;
  /** `null` when cancelled. */
  promise: Promise<TileResult | null>;
}

/** A saved file and the layer grid record stored beside it. */
export interface SavedFile {
  bytes: Uint8Array<ArrayBuffer>;
  /** The `psdMeta` value `layers:<fingerprint>` for this file. */
  layers: string;
}

let nextId = 1;

class EngineWorker {
  readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (r: Ok) => void; reject: (e: Error) => void }
  >();
  dead = false;

  constructor(onDeath: (error: Error) => void) {
    // Constructed on first use, never at module load: WKWebView deadlocks on
    // eager module workers (apps/web/AGENTS.md).
    this.worker = new Worker(new URL('./psd.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener(
      'message',
      (event: MessageEvent<PsdResponse>) => {
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
      const error = new Error(`psd engine worker failed: ${event.message}`);
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
      onDeath(error);
    });
  }

  request(body: Body, transfer: Transferable[] = []): Promise<Ok> {
    return this.requestWithId(nextId++, body, transfer);
  }

  requestWithId(id: number, body: Body, transfer: Transferable[] = []) {
    if (this.dead) return Promise.reject(new Error('the image engine stopped'));
    return new Promise<Ok>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id } as PsdRequest, transfer);
    });
  }

  cancel(ids: number[]) {
    if (ids.length === 0 || this.dead) return;
    this.worker.postMessage({ id: 0, kind: 'cancel', ids } as PsdRequest);
  }

  terminate() {
    this.dead = true;
    this.worker.terminate();
    for (const waiting of this.pending.values())
      waiting.reject(new Error('the document was closed'));
    this.pending.clear();
  }
}

const parse = <T>(r: Ok): T => {
  if (r.kind !== 'json') throw new Error('unexpected response');
  return JSON.parse(r.json) as T;
};

const bytesOf = (r: Ok): Uint8Array<ArrayBuffer> => {
  if (r.kind !== 'bytes') throw new Error('unexpected response');
  return new Uint8Array(r.bytes);
};

export class PsdEngine {
  private readonly worker: EngineWorker;
  /** Work (a last save) that keeps the worker alive after close. */
  private readonly holds = new Set<Promise<unknown>>();
  private onFailure?: (error: Error) => void;

  private constructor(
    worker: EngineWorker,
    /** The document as it opened. */
    readonly summary: Summary,
    /** What could not be read in the file. */
    readonly warnings: string[]
  ) {
    this.worker = worker;
  }

  /** The bytes of a new document: a white Background, or one empty layer. */
  static async blank(
    width: number,
    height: number,
    white = true
  ): Promise<Uint8Array<ArrayBuffer>> {
    const worker = new EngineWorker(() => {});
    try {
      return bytesOf(
        await worker.request({ kind: 'blank', width, height, white })
      );
    } finally {
      worker.terminate();
    }
  }

  /** Opens a `.psd` or `.psb` file. `bytes` is copied; the caller keeps it. */
  static async open(
    bytes: ArrayBuffer,
    options: { onFailure?: (error: Error) => void } = {}
  ): Promise<PsdEngine> {
    let engine: PsdEngine | undefined;
    const worker = new EngineWorker((e) => engine?.onFailure?.(e));
    try {
      const copy = bytes.slice(0);
      const r = await worker.request({ kind: 'open', bytes: copy }, [copy]);
      if (r.kind !== 'open') throw new Error('unexpected response');
      engine = new PsdEngine(worker, r.summary, r.warnings);
      engine.onFailure = options.onFailure;
      return engine;
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  private async query<T>(
    method: QueryMethod,
    ...args: (number | null)[]
  ): Promise<T> {
    return parse<T>(await this.worker.request({ kind: 'query', method, args }));
  }

  private async bytes(
    method: BytesMethod,
    ...args: (number | null)[]
  ): Promise<Uint8Array<ArrayBuffer>> {
    return bytesOf(await this.worker.request({ kind: 'bytes', method, args }));
  }

  /** The document as it is now (after edits). */
  currentSummary(): Promise<Summary> {
    return this.query('summary');
  }

  /** The layers panel, top to bottom. */
  layers(): Promise<LayerRow[]> {
    return this.query('layers');
  }

  /** One layer's properties; `null` when it does not exist. */
  layerInfo(id: number): Promise<LayerInfo | null> {
    return this.query('layerInfo', id);
  }

  /** The topmost layer drawing at a canvas point (the move tool's pick). */
  hitTest(x: number, y: number): Promise<number | null> {
    return this.query('hitTest', Math.floor(x), Math.floor(y));
  }

  /** The selection's bounds and outline. */
  selectionInfo(): Promise<SelectionInfo> {
    return this.query('selectionInfo');
  }

  /** Fonts text layers use and whether each is available. */
  fonts(): Promise<FontUse[]> {
    return this.query('fonts');
  }

  /** The document described for search and agents. */
  describe(): Promise<string> {
    return this.query('describe');
  }

  /** Whether anything changed since the file was opened. */
  isEdited(): Promise<boolean> {
    return this.query('isEdited');
  }

  /** Queues a tile render. */
  render(tile: TileRequest): PendingTile {
    const id = nextId++;
    const run = async (): Promise<TileResult | null> => {
      const r = await this.worker.requestWithId(id, {
        kind: 'render',
        ...tile,
      });
      return r.kind === 'render'
        ? { bitmap: r.bitmap, millis: r.millis }
        : null;
    };
    return { id, promise: run() };
  }

  /** Drops queued renders that have not started. */
  cancel(ids: number[]) {
    this.worker.cancel(ids);
  }

  /** The straight RGBA color at a canvas point (merged, or of one layer). */
  async sample(
    x: number,
    y: number,
    layer?: number
  ): Promise<[number, number, number, number]> {
    const b = await this.bytes(
      'sample',
      Math.floor(x),
      Math.floor(y),
      layer ?? null
    );
    return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  }

  /** A layer drawn alone, fitted in `size` pixels (PNG); `null` when empty. */
  async thumbnail(id: number, size: number): Promise<Blob | null> {
    const b = await this.bytes('thumbnail', id, size);
    return b.length > 0 ? new Blob([b], { type: 'image/png' }) : null;
  }

  /** The merged image fitted in `size` pixels (PNG). */
  async preview(size: number): Promise<Blob> {
    return new Blob([await this.bytes('preview', size)], { type: 'image/png' });
  }

  /** The selected pixels (of a layer, or merged) as PNG, for the clipboard. */
  async copyPixels(layer?: number): Promise<Blob> {
    return new Blob([await this.bytes('copyPixels', layer ?? null)], {
      type: 'image/png',
    });
  }

  /** One layer (or the merged image) as PNG. */
  async exportPng(layer?: number): Promise<Blob> {
    return new Blob([await this.bytes('exportPng', layer ?? null)], {
      type: 'image/png',
    });
  }

  /** The merged image as JPEG over white. */
  async exportJpeg(quality: number): Promise<Blob> {
    return new Blob([await this.bytes('exportJpeg', quality)], {
      type: 'image/jpeg',
    });
  }

  /** Applies edit operations (see `psd_engine::edit::Op`) as one step. */
  async apply(ops: Op[], coalesce?: string): Promise<EditResult> {
    return parse<EditResult>(
      await this.worker.request({
        kind: 'edit',
        action: 'apply',
        ops: JSON.stringify(ops),
        coalesce,
      })
    );
  }

  async undo(): Promise<EditResult> {
    return parse(await this.worker.request({ kind: 'edit', action: 'undo' }));
  }

  async redo(): Promise<EditResult> {
    return parse(await this.worker.request({ kind: 'edit', action: 'redo' }));
  }

  /** Changes this person's selection; resolves to its outline. */
  async select(spec: SelectSpec): Promise<SelectionInfo> {
    return parse(
      await this.worker.request({ kind: 'select', spec: JSON.stringify(spec) })
    );
  }

  /**
   * Places an image (PNG, JPEG, GIF, WebP) as a new layer, centered on a
   * canvas point (the canvas when absent), above a layer when given.
   */
  async placeImage(
    bytes: ArrayBuffer,
    name: string,
    at?: { x: number; y: number },
    above?: number
  ): Promise<EditResult> {
    const copy = bytes.slice(0);
    return parse(
      await this.worker.request(
        {
          kind: 'placeImage',
          bytes: copy,
          name,
          x: at ? Math.round(at.x) : null,
          y: at ? Math.round(at.y) : null,
          above: above ?? null,
        },
        [copy]
      )
    );
  }

  /** The edited document as `.psd` bytes, with its layer grid record. */
  async save(): Promise<SavedFile> {
    const r = await this.worker.request({ kind: 'save' });
    if (r.kind !== 'saved') throw new Error('unexpected response');
    return { bytes: new Uint8Array(r.bytes), layers: r.layers };
  }

  /**
   * Starts editing together: new layers get ids in `session` (a u16
   * unique among the people editing), `layers` is the shared
   * `layers:<fingerprint>` of the opened file when there is one, and
   * `seed` asks for every layer's state (the first person in a new shared
   * document). Resolves to the changes to write.
   */
  async enableCollab(
    session: number,
    layers: string | null,
    seed: boolean
  ): Promise<EntryChange[]> {
    return parse(
      await this.worker.request({ kind: 'enableCollab', session, layers, seed })
    );
  }

  /** The shared-map changes of this person's steps since the last call. */
  async collabChanges(): Promise<EntryChange[]> {
    return parse(await this.worker.request({ kind: 'collabChanges' }));
  }

  /** Applies other people's changes (not undoable here). */
  async applyCollab(changes: EntryChange[]): Promise<EditResult> {
    return parse(
      await this.worker.request({
        kind: 'edit',
        action: 'remote',
        changes: JSON.stringify(changes),
      })
    );
  }

  /** The `layers:<fingerprint>` value for the file `save` writes now. */
  async fileLayers(): Promise<string> {
    return JSON.stringify(await this.query<unknown>('fileLayers'));
  }

  /**
   * Makes a font available to text layout (TTF, OTF, WOFF, or WOFF2), as
   * `family` when given. Resolves to the faces registered.
   */
  async registerFont(
    bytes: ArrayBuffer,
    family?: string
  ): Promise<RegisteredFace[]> {
    const copy = bytes.slice(0);
    return parse(
      await this.worker.request(
        { kind: 'registerFont', bytes: copy, family: family ?? null },
        [copy]
      )
    );
  }

  get failed(): boolean {
    return this.worker.dead;
  }

  /**
   * Keeps the document open until `work` settles, even if it is closed
   * first (so the save started when the editor goes away can finish).
   */
  retain(work: Promise<unknown>) {
    this.holds.add(work);
    void work.finally(() => this.holds.delete(work));
  }

  close() {
    const worker = this.worker;
    if (this.holds.size === 0) {
      worker.terminate();
      return;
    }
    const finish = async () => {
      await Promise.allSettled([...this.holds]);
      worker.terminate();
    };
    void finish();
  }
}
