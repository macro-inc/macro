import type { IForeignRecordRef } from '@macro-inc/collaboration/session/compatibility.generated';
import type { RecordMirror } from './mirror';

/** A real, read-only Map that materializes only explicitly requested node handles. */
export class LazyNodeMap<Node> extends Map<string, Node> {
  constructor(
    private readonly mirror: RecordMirror,
    private readonly version: bigint,
    private readonly resolve: (record: IForeignRecordRef) => Node
  ) {
    super();
    mirror.count(version);
  }
  override get size(): number {
    return this.mirror.count(this.version);
  }
  override get(key: string): Node | undefined {
    const record = this.mirror.get(this.version, key);
    return record === null ? undefined : this.resolve(record);
  }
  override has(key: string): boolean {
    return this.mirror.get(this.version, key) !== null;
  }
  override *keys(): MapIterator<string> {
    yield* this.mirror.keys(this.version);
  }
  override *entries(): MapIterator<[string, Node]> {
    for (const key of this.mirror.keys(this.version)) {
      const record = this.mirror.get(this.version, key);
      if (record !== null) yield [key, this.resolve(record)];
    }
  }
  override *values(): MapIterator<Node> {
    for (const [, node] of this.entries()) yield node;
  }
  override [Symbol.iterator](): MapIterator<[string, Node]> {
    return this.entries();
  }
  override forEach(
    callback: (value: Node, key: string, map: Map<string, Node>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, node] of this.entries())
      callback.call(thisArg, node, key, this);
  }
  override set(_key: string, _node: Node): this {
    throw new TypeError('Native node map is read-only');
  }
  override delete(_key: string): boolean {
    throw new TypeError('Native node map is read-only');
  }
  override clear(): void {
    throw new TypeError('Native node map is read-only');
  }
}
