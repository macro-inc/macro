import { decodeHostPacket } from '../../../lexical-conformance/diff/host-packet';
import * as wasm from '../../../lexical-conformance/pkg/web/lexical_conformance_wasm';
import type { ShimBackend } from './index';

let initialized = false;
let api: ReadonlyMap<string, number>;
const commands = new WeakMap<object, string>();
let nextCommand = 0;
type Callback = (argument: unknown) => unknown;
const collectionListeners = new Set<() => void>();
const versionListeners = new Set<(version: string) => void>();
const active: ConformanceBackend[] = [];
const editors = new FinalizationRegistry<wasm.EditorHandle>((handle) => {
  handle.free();
  for (const listener of [...collectionListeners]) listener();
});

// Rust retains this bridge, so it must not strongly retain the JS callback
// that can close over the editor. The backend owns registered callbacks in JS.
function weakCallback(callback: Callback): Callback {
  const reference = new WeakRef(callback);
  return (argument) => {
    const target = reference.deref();
    if (target === undefined)
      throw new Error('registered callback was collected');
    return target(argument);
  };
}

function commandIdentity(command: object): string {
  let id = commands.get(command);
  if (id === undefined) {
    id = `command:${++nextCommand}`;
    commands.set(command, id);
  }
  return id;
}

/** Tests load the pinned optimized artifact synchronously before importing the facade. */
export function initializeConformance(
  module: WebAssembly.Module,
  expectedVersion: string
): void {
  wasm.initSync({ module });
  if (wasm.upstream_version() !== expectedVersion)
    throw new Error('conformance upstream version mismatch');
  api = new Map(wasm.EditorHandle.api_index().map((name, id) => [name, id]));
  initialized = true;
}

export const diagnostics = {
  liveEditors: () => wasm.debug_live_editors(),
  crossings: () => wasm.debug_crossings(),
  bytes: () => wasm.debug_boundary_bytes(),
  resetCounters: () => wasm.debug_reset_counters(),
  resetKeys: () => wasm.reset_key_counter(),
  onVersionReleased(listener: (version: string) => void): () => void {
    versionListeners.add(listener);
    return () => {
      versionListeners.delete(listener);
    };
  },
  onCollected(listener: () => void): () => void {
    collectionListeners.add(listener);
    return () => {
      collectionListeners.delete(listener);
    };
  },
};

/** The shim has one model backend, with no production-session fallback. */
export class ConformanceBackend implements ShimBackend {
  private readonly handle: wasm.EditorHandle;
  private readonly callbacks = new Map<number, Callback>();
  private readonly bridges = new WeakMap<Callback, Callback>();
  private disposed = false;
  private pending = false;
  private nodeHandles?: object;
  private readonly collections = new Map<
    string,
    {
      unowned: () => boolean;
      released: () => void;
    }
  >();

  constructor(config: unknown) {
    if (!initialized) throw new Error('conformance WASM is not initialized');
    this.handle = new wasm.EditorHandle(config);
    editors.register(this, this.handle, this);
  }
  private bridge(callback: Callback): Callback {
    let bridge = this.bridges.get(callback);
    if (bridge === undefined) {
      bridge = weakCallback(callback);
      this.bridges.set(callback, bridge);
    }
    return bridge;
  }
  private enter<T>(body: (handle: wasm.EditorHandle) => T): T {
    // The JS owner must survive synchronous GC in a callback, even if a caller
    // no longer uses its backend reference after entering the native operation.
    active.push(this);
    try {
      return body(this.handle);
    } finally {
      active.pop();
    }
  }
  beginUpdate(tags: readonly string[], discrete: boolean): void {
    this.enter((handle) => handle.begin_update(tags, discrete));
    this.pending = true;
  }
  call(name: string, args: readonly unknown[], receiver?: unknown): unknown {
    const id = api.get(name);
    if (id === undefined) throw new Error(`unknown Lexical API: ${name}`);
    return this.enter((handle) =>
      handle.call(
        id,
        receiver === undefined ? { args } : { args, this: receiver }
      )
    );
  }
  flush(): void {
    this.enter((handle) => handle.flush());
  }
  finishNoop(): boolean {
    const finished = this.enter((handle) => handle.finish_noop());
    if (finished) {
      this.pending = false;
      this.collect();
    }
    return finished;
  }
  commit() {
    // A rejected nested commit has not closed the leased native update.
    if (active.includes(this))
      throw new Error('editor is executing a model operation');
    try {
      return decodeHostPacket(this.enter((handle) => handle.commit()));
    } finally {
      this.pending = false;
      this.collect();
    }
  }
  discard(): void {
    this.enter((handle) => handle.discard_update());
    this.pending = false;
    this.collect();
  }
  readField(handle: number, field: string): unknown {
    return this.enter((editor) => editor.read_field(handle, field));
  }
  ownNodeHandles(cache: object): void {
    if (this.disposed) throw new Error('editor is disposed');
    if (this.nodeHandles !== undefined)
      throw new Error('editor already owns its node handle cache');
    this.nodeHandles = cache;
  }
  releaseVersion(version: string): void {
    if (this.disposed) return;
    this.enter((handle) => handle.release_version(version));
    this.notifyVersionReleased(version);
  }
  private notifyVersionReleased(version: string): void {
    // Diagnostics observe completed cleanup and cannot interrupt publication.
    for (const listener of [...versionListeners])
      queueMicrotask(() => listener(version));
  }
  collectVersion(
    version: string,
    unowned: () => boolean,
    released: () => void
  ): void {
    if (this.disposed) {
      if (unowned()) released();
      return;
    }
    this.collections.set(version, { unowned, released });
    this.collect();
  }
  private collect(): void {
    if (this.pending || this.disposed) return;
    for (const [version, collection] of this.collections) {
      if (collection.unowned()) {
        this.enter((handle) => handle.release_version(version));
        this.collections.delete(version);
        collection.released();
        this.notifyVersionReleased(version);
      } else {
        this.collections.delete(version);
      }
    }
  }
  registerTransform(
    type: string,
    dispatch: (node: unknown) => unknown
  ): number {
    const id = this.enter((handle) =>
      handle.register_transform(type, this.bridge(dispatch))
    );
    this.callbacks.set(id, dispatch);
    return id;
  }
  registerListener(
    command: object,
    priority: number,
    dispatch: (payload: unknown) => unknown
  ): number {
    if (!Number.isInteger(priority) || priority < 0 || priority > 4)
      throw new Error('invalid command priority');
    const id = this.enter((handle) =>
      handle.register_listener(
        commandIdentity(command),
        priority,
        this.bridge(dispatch)
      )
    );
    this.callbacks.set(id, dispatch);
    return id;
  }
  dispatchCommand(command: object, payload: unknown): boolean {
    return this.enter((handle) =>
      handle.dispatch_command(commandIdentity(command), payload)
    );
  }
  unregister(id: number): void {
    this.enter((handle) => handle.unregister(id));
    const callback = this.callbacks.get(id);
    // A synchronous model listener snapshot can still invoke an unregistered
    // callback later in this job. Keep its JS owner through that callback phase.
    queueMicrotask(() => {
      if (this.callbacks.get(id) === callback) this.callbacks.delete(id);
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.enter((handle) => handle.free());
    this.disposed = true;
    editors.unregister(this);
    this.callbacks.clear();
    this.collections.clear();
    this.nodeHandles = undefined;
  }
}
