import { decodeHostPacket } from '../../../lexical-conformance/diff/host-packet';
import * as wasm from '../../../lexical-conformance/pkg/web/lexical_conformance_wasm';
import type { ShimBackend } from './index';

let initialized = false;
let api: ReadonlyMap<string, number>;
const commands = new WeakMap<object, string>();
let nextCommand = 0;

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
};

/** The shim has one model backend, with no production-session fallback. */
export class ConformanceBackend implements ShimBackend {
  private readonly handle: wasm.EditorHandle;

  constructor(config: unknown) {
    if (!initialized) throw new Error('conformance WASM is not initialized');
    this.handle = new wasm.EditorHandle(config);
  }
  beginUpdate(tags: readonly string[], discrete: boolean): void {
    this.handle.begin_update(tags, discrete);
  }
  call(name: string, args: readonly unknown[], receiver?: unknown): unknown {
    const id = api.get(name);
    if (id === undefined) throw new Error(`unknown Lexical API: ${name}`);
    return this.handle.call(
      id,
      receiver === undefined ? { args } : { args, this: receiver }
    );
  }
  flush(): void {
    this.handle.flush();
  }
  finishNoop(): boolean {
    return this.handle.finish_noop();
  }
  commit() {
    return decodeHostPacket(this.handle.commit());
  }
  discard(): void {
    this.handle.discard_update();
  }
  readField(handle: number, field: string): unknown {
    return this.handle.read_field(handle, field);
  }
  releaseVersion(version: string): void {
    this.handle.release_version(version);
  }
  registerTransform(
    type: string,
    dispatch: (node: unknown) => unknown
  ): number {
    return this.handle.register_transform(type, dispatch);
  }
  registerListener(
    command: object,
    priority: number,
    dispatch: (payload: unknown) => unknown
  ): number {
    if (!Number.isInteger(priority) || priority < 0 || priority > 4)
      throw new Error('invalid command priority');
    return this.handle.register_listener(
      commandIdentity(command),
      priority,
      dispatch
    );
  }
  dispatchCommand(command: object, payload: unknown): boolean {
    return this.handle.dispatch_command(commandIdentity(command), payload);
  }
  unregister(id: number): void {
    this.handle.unregister(id);
  }
  dispose(): void {
    this.handle.free();
  }
}
