import type { ShimBackend } from './backend';

// Ephemeron ownership keeps the editor and captured version alive with a node,
// without making the editor's weak identity cache a root for its own nodes.
const owners = new WeakMap<object, { cache: object; version: object }>();
const collectedVersions = new FinalizationRegistry<{
  cache: WeakRef<NodeHandles<object>>;
  version: number;
}>(({ cache, version }) => cache.deref()?.release(version));

interface RecordHandle<Node extends object> {
  readonly key: string;
  readonly type: string;
  readonly version: number;
  node?: WeakRef<Node>;
}

/** Per-editor identities for captured model records, independent of getLatest(). */
export class NodeHandles<Node extends object> {
  private readonly records = new Map<number, RecordHandle<Node>>();
  private readonly versions = new Map<number, WeakRef<object>>();

  constructor(
    private readonly backend: ShimBackend,
    private readonly create: (
      handle: number,
      key: string,
      type: string,
      version: number
    ) => Node
  ) {
    backend.ownNodeHandles(this);
  }

  private record(value: unknown): readonly [number, RecordHandle<Node>] {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('$h' in value) ||
      typeof value.$h !== 'number' ||
      !Number.isSafeInteger(value.$h) ||
      value.$h < 0
    )
      throw new Error('invalid node handle');
    const id = value.$h;
    let record = this.records.get(id);
    if (record === undefined) {
      if (
        !('key' in value) ||
        typeof value.key !== 'string' ||
        !('type' in value) ||
        typeof value.type !== 'string' ||
        !('ver' in value) ||
        typeof value.ver !== 'number' ||
        !Number.isSafeInteger(value.ver) ||
        value.ver < 0
      )
        throw new Error('unknown node handle without record metadata');
      record = { key: value.key, type: value.type, version: value.ver };
      this.records.set(id, record);
    }
    return [id, record];
  }

  node(value: unknown): Node {
    const [id, record] = this.record(value);
    const existing = record.node?.deref();
    if (existing !== undefined) return existing;
    const node = this.create(id, record.key, record.type, record.version);
    this.own(record, node);
    return node;
  }

  /** Bind a JS constructor's actual instance before its derived fields initialize. */
  adopt(value: unknown, node: Node): void {
    const [, record] = this.record(value);
    if (record.node?.deref() !== undefined)
      throw new Error('node handle already has an instance');
    this.own(record, node);
  }

  hasIdentity(handle: number, node: Node): boolean {
    return this.records.get(handle)?.node?.deref() === node;
  }

  private own(record: RecordHandle<Node>, node: Node): void {
    if (owners.has(node)) throw new Error('node factory reused an instance');
    owners.set(node, { cache: this, version: this.pinVersion(record.version) });
    record.node = new WeakRef(node);
  }

  /** Retain immutable records with an EditorState, even if it has no live node. */
  pinVersion(id: number): object {
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error('invalid node version');
    let version = this.versions.get(id)?.deref();
    if (version === undefined) {
      version = {};
      this.versions.set(id, new WeakRef(version));
      collectedVersions.register(version, {
        cache: new WeakRef(this),
        version: id,
      });
    }
    return version;
  }

  /** Finalizer callback; a replacement token can already own this version. */
  release(version: number): void {
    if (this.versions.get(version)?.deref() !== undefined) return;
    this.backend.collectVersion(
      String(version),
      () => this.versions.get(version)?.deref() === undefined,
      () => {
        this.versions.delete(version);
        for (const [id, record] of this.records) {
          if (record.version === version) this.records.delete(id);
        }
      }
    );
  }
}
