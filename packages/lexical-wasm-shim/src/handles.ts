import type { ShimBackend } from './backend';

// Ephemeron ownership keeps the editor and captured version alive with a node,
// without making the editor's weak identity cache a root for its own nodes.
const owners = new WeakMap<object, { cache: object; version: object }>();
const collectedVersions = new FinalizationRegistry<{
  cache: WeakRef<NodeHandles<object>>;
  version: number;
}>(({ cache, version }) => cache.deref()?.release(version));

/** Per-editor identities for captured model records, independent of getLatest(). */
export class NodeHandles<Node extends object> {
  private readonly records = new Map<
    number,
    { key: string; type: string; version: number; node?: WeakRef<Node> }
  >();
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

  node(value: unknown): Node {
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
    const existing = record.node?.deref();
    if (existing !== undefined) return existing;
    let version = this.versions.get(record.version)?.deref();
    if (version === undefined) {
      version = {};
      this.versions.set(record.version, new WeakRef(version));
      collectedVersions.register(version, {
        cache: new WeakRef(this),
        version: record.version,
      });
    }
    const node = this.create(id, record.key, record.type, record.version);
    if (owners.has(node)) throw new Error('node factory reused an instance');
    owners.set(node, { cache: this, version });
    record.node = new WeakRef(node);
    return node;
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
