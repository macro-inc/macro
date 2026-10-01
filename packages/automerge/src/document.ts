import * as A from '@automerge/automerge';

export type PeerID = string;
export type ContainerID = string;
export type Side = -1 | 0 | 1;
export type ContainerType = 'Map' | 'List' | 'MovableList' | 'Text' | 'Counter';
export type Value =
  | string
  | number
  | boolean
  | null
  | undefined
  | Uint8Array
  | Value[]
  | { [key: string]: Value };
export type Path = (string | number)[];
export type JsonObject = { [key: string]: A.AutomergeValue };
export type ImportStatus = {
  success: Map<string, boolean>;
  pending?: Map<string, boolean>;
};
export type DocEvent = {
  by: 'local' | 'import' | 'checkout';
  origin: string;
  from: string[];
  to: string[];
  events: {
    path: Path;
    target: string;
    diff: { type: string; updated: Record<string, unknown> };
  }[];
};

export class Revision {
  readonly heads: string[];
  constructor(heads: string[] = []) {
    this.heads = [...heads].sort();
  }
  encode() {
    return new TextEncoder().encode(JSON.stringify(this.heads));
  }
  static decode(bytes: Uint8Array) {
    return new Revision(JSON.parse(new TextDecoder().decode(bytes)));
  }
  compare(other: Revision) {
    return JSON.stringify(this.heads) === JSON.stringify(other.heads)
      ? 0
      : undefined;
  }
  toJSON() {
    return this.heads;
  }
}

export function atPath(root: unknown, path: Path): any {
  return path.reduce<any>((value, key) => value?.[key], root);
}
export const LIST_TAG = '__macro_automerge_list';
export function isList(value: any): boolean {
  return !!value && String(value[LIST_TAG]) === 'v1';
}
export function emptyList() {
  return { [LIST_TAG]: new A.ImmutableString('v1'), items: {}, order: [] };
}
export function listKeys(value: any): string[] {
  return [...new Set<string>(value.order.map(String))].filter(
    (key) => value.items[key] !== undefined
  );
}
export function plain<T>(value: T): T {
  if (value instanceof A.ImmutableString) return value.toString() as T;
  if (value instanceof A.Counter) return Number(value) as T;
  if (isList(value))
    return listKeys(value).map((key) => plain((value as any).items[key])) as T;
  if (Array.isArray(value)) return value.map(plain) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, plain(child)])
    ) as T;
  return value;
}

/** Values set through a map are scalar strings. Editable text is explicit. */
export function scalar(value: unknown): any {
  if (typeof value === 'string') return new A.ImmutableString(value);
  if (value instanceof Uint8Array || value instanceof A.Counter) return value;
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, scalar(v)])
    );
  return value;
}

function objectIdentity(root: unknown, path: Path): string | undefined {
  const value = atPath(root, path);
  const parent = atPath(root, path.slice(0, -1));
  if (value instanceof A.Counter)
    return `${A.getObjectId(parent)}:counter:${String(path.at(-1))}`;
  if (typeof value === 'string' && path.length)
    return A.getObjectId(parent, path.at(-1)) ?? undefined;
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof A.ImmutableString) &&
    !(value instanceof Uint8Array)
  )
    return A.getObjectId(value) ?? undefined;
}

export class Cursor {
  constructor(
    readonly object: ContainerID,
    readonly position: string,
    readonly offset = 0,
    readonly element?: string
  ) {}
  containerId() {
    return this.object;
  }
  encode() {
    return new TextEncoder().encode(
      JSON.stringify({
        object: this.object,
        position: this.position,
        offset: this.offset,
        element: this.element,
      })
    );
  }
  static decode(bytes: Uint8Array) {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return new Cursor(
      value.object,
      value.position,
      value.offset,
      value.element
    );
  }
}

/** Mutable application boundary around immutable native Automerge documents.
 * All persisted/exported bytes are native Automerge; commit batches notifications.
 */
export class AutomergeDoc {
  value: A.Doc<JsonObject> = A.init<JsonObject>();
  private pending?: string[];
  private historical?: A.Doc<JsonObject>;
  private listeners = new Set<(event: DocEvent) => void>();
  private localListeners = new Set<(bytes: Uint8Array) => void>();
  private paths = new Map<string, Path>();
  private indexed?: A.Doc<JsonObject>;
  private disposed = false;
  get current() {
    return this.historical ?? this.value;
  }
  get peerIdStr() {
    return BigInt(`0x${A.getActorId(this.value)}`).toString();
  }
  get peerId() {
    return BigInt(this.peerIdStr);
  }
  constructor() {
    this.setPeerId(
      BigInt(`0x${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`)
    );
  }
  setPeerId(peer: bigint | string) {
    this.commit();
    const next = A.clone(this.value, {
      actor: BigInt(peer).toString(16).padStart(16, '0'),
    });
    A.free(this.value);
    this.value = next;
  }
  setRecordTimestamp(_enabled: boolean) {}
  version() {
    return new Revision(A.getHeads(this.current));
  }
  oplogVersion() {
    return new Revision(A.getHeads(this.value));
  }
  frontiers() {
    return A.getHeads(this.current);
  }
  oplogFrontiers() {
    return A.getHeads(this.value);
  }
  vvToFrontiers(version: Revision) {
    return version.heads;
  }
  frontiersToVV(heads: string[]) {
    return new Revision(heads);
  }
  toJSON(): any {
    return plain(this.current);
  }
  getShallowValue() {
    return Object.fromEntries(
      Object.keys(this.current).map((key) => [
        key,
        this.wrap([key])?.id ?? this.current[key],
      ])
    );
  }
  toJsonWithReplacer(replacer: (key: string, value: unknown) => unknown) {
    return JSON.parse(JSON.stringify(plain(this.current), replacer));
  }
  mutate(callback: A.ChangeFn<JsonObject>) {
    if (this.disposed || this.historical)
      throw new Error('Document is not writable');
    this.pending ??= A.getHeads(this.value);
    this.value = A.change(this.value, callback);
  }
  changeAt(heads: string[], callback: A.ChangeFn<JsonObject>): string[] {
    this.commit();
    const before = A.getHeads(this.value);
    const result = A.changeAt(this.value, heads, callback);
    this.value = result.newDoc;
    this.pending = before;
    this.commit({ origin: 'history-apply' });
    return result.newHeads ?? heads;
  }
  commit(
    options: { origin?: string; timestamp?: number; message?: string } = {}
  ) {
    const before = this.pending;
    this.pending = undefined;
    if (
      !before ||
      JSON.stringify(before) === JSON.stringify(A.getHeads(this.value))
    )
      return;
    const bytes = A.saveSince(this.value, before);
    this.emit('local', before, options.origin ?? '');
    for (const listener of this.localListeners) listener(bytes);
  }
  private emit(by: DocEvent['by'], before: string[], origin = '') {
    const patches = A.diff(this.value, before, A.getHeads(this.value));
    const events = patches.map((patch) => {
      const path = patch.path.slice(0, -1);
      const key = String(patch.path.at(-1));
      const target = this.wrap(path)?.id ?? '_root';
      return {
        path,
        target,
        diff: {
          type: 'map',
          updated: { [key]: atPath(this.current, patch.path) },
        },
      };
    });
    const event: DocEvent = {
      by,
      from: before,
      to: this.frontiers(),
      origin,
      events,
    };
    for (const listener of this.listeners) listener(event);
  }
  subscribe(listener: (event: DocEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  subscribeLocalUpdates(listener: (bytes: Uint8Array) => void) {
    this.localListeners.add(listener);
    return () => this.localListeners.delete(listener);
  }
  import(bytes: Uint8Array): ImportStatus {
    return this.importBatch([bytes]);
  }
  importBatch(updates: Uint8Array[]): ImportStatus {
    this.commit();
    const before = A.getHeads(this.value);
    for (const bytes of updates)
      if (bytes.length) {
        if (
          bytes.length < 10 ||
          ![0x85, 0x6f, 0x4a, 0x83].every(
            (byte, index) => bytes[index] === byte
          )
        )
          throw new Error('Invalid Automerge update header');
        this.value = A.loadIncremental(this.value, bytes);
      }
    const missing = A.getMissingDeps(this.value, []);
    const success = new Map(
      A.getHeads(this.value)
        .filter((head) => !before.includes(head))
        .map((head) => [head, true])
    );
    if (success.size) this.emit('import', before);
    return {
      success,
      pending: missing.length
        ? new Map(missing.map((hash) => [hash, true]))
        : undefined,
    };
  }
  export(options: {
    mode: 'snapshot' | 'shallow-snapshot' | 'update';
    from?: Revision;
    frontiers?: string[];
  }): Uint8Array {
    this.commit();
    if (options.mode === 'update')
      return A.saveSince(
        this.value,
        options.from?.heads.filter((head) => A.hasHeads(this.value, [head])) ??
          []
      );
    return A.save(this.current);
  }
  fork() {
    return this.forkAt(A.getHeads(this.current));
  }
  forkAt(heads: string[]) {
    this.commit();
    const doc = new AutomergeDoc();
    A.free(doc.value);
    doc.value = A.clone(A.view(this.value, heads), {
      actor: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    });
    return doc;
  }
  checkout(heads: string[]) {
    this.commit();
    this.historical = A.view(this.value, heads);
    this.emit('checkout', heads);
  }
  checkoutToLatest() {
    this.historical = undefined;
  }
  getAllChanges() {
    const result = new Map<string, ReturnType<typeof A.decodeChange>[]>();
    for (const bytes of A.getAllChanges(this.value)) {
      const change = A.decodeChange(bytes);
      const peer = BigInt(`0x${change.actor}`).toString();
      const changes = result.get(peer) ?? [];
      changes.push(change);
      result.set(peer, changes);
    }
    return result;
  }
  ensureRoot(key: string, kind: 'map' | 'list' | 'text') {
    if (this.current[key] !== undefined) return;
    if (this.historical) return;
    // Root creation has one deterministic ancestor, even for offline first edits.
    const actor = Array.from(
      new TextEncoder().encode(`macro-root:${kind}:${key}`),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    let seed = A.init<JsonObject>({ actor });
    seed = A.change(seed, { time: 0 }, (draft) => {
      draft[key] = kind === 'map' ? {} : kind === 'list' ? emptyList() : '';
    });
    this.pending ??= A.getHeads(this.value);
    this.value = A.merge(this.value, seed);
    A.free(seed);
  }
  getMap(key: string) {
    return new AutomergeMap(this, [key]);
  }
  getList(key: string) {
    return new AutomergeList(this, [key]);
  }
  getMovableList(key: string) {
    return new AutomergeMovableList(this, [key]);
  }
  getText(key: string) {
    return new AutomergeText(this, [key]);
  }
  index() {
    if (this.indexed === this.current) return;
    this.paths.clear();
    const visit = (value: any, path: Path) => {
      const id = objectIdentity(this.current, path);
      if (id) this.paths.set(id, path);
      if (isList(value)) {
        for (const key of listKeys(value))
          visit(value.items[key], [...path, 'items', key]);
      } else if (Array.isArray(value))
        value.forEach((item, i) => visit(item, [...path, i]));
      else if (
        value &&
        typeof value === 'object' &&
        !(value instanceof A.ImmutableString) &&
        !(value instanceof Uint8Array) &&
        !(value instanceof A.Counter)
      )
        for (const [key, child] of Object.entries(value))
          visit(child, [...path, key]);
    };
    visit(this.current, []);
    this.indexed = this.current;
  }
  path(id: string) {
    this.index();
    return this.paths.get(id);
  }
  getContainerIds() {
    this.index();
    return [...this.paths.keys()];
  }
  getContainerById(id: string): Container | undefined {
    const path = this.path(id);
    return path ? this.wrap(path) : undefined;
  }
  wrap(path: Path): Container | undefined {
    const value = atPath(this.current, path);
    if (typeof value === 'string') return new AutomergeText(this, path);
    if (value instanceof A.Counter) return new AutomergeCounter(this, path);
    if (isList(value)) return new AutomergeMovableList(this, path);
    if (
      value &&
      typeof value === 'object' &&
      !(value instanceof A.ImmutableString) &&
      !(value instanceof Uint8Array)
    )
      return new AutomergeMap(this, path);
  }
  getCursorPos(cursor: Cursor) {
    const path = this.path(cursor.object);
    if (!path) throw new Error('Cursor target was deleted');
    const value = atPath(this.current, path);
    if (typeof value === 'string')
      return {
        offset: A.getCursorPosition(this.current, path, cursor.position),
        side: 0 as Side,
      };
    const keys = listKeys(value);
    const index = cursor.element ? keys.indexOf(cursor.element) : -1;
    return {
      offset: index >= 0 ? index : Math.min(cursor.offset, keys.length),
      side: 0 as Side,
    };
  }
  free() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.localListeners.clear();
    A.free(this.value);
  }
}

abstract class BaseContainer {
  private objectId?: string;
  get id(): string {
    return (
      this.objectId ??
      (this.doc && this.initialPath.length === 1
        ? A.getObjectId(this.doc.current, this.initialPath[0])
        : undefined) ??
      JSON.stringify(this.initialPath)
    );
  }
  private initialPath: Path;
  constructor(
    readonly doc?: AutomergeDoc,
    path: Path = []
  ) {
    this.initialPath = path;
    this.objectId = doc ? objectIdentity(doc.current, path) : undefined;
  }
  get path() {
    if (!this.doc) return this.initialPath;
    const found = this.doc.path(this.id);
    if (found) return found;
    if (!this.objectId && this.initialPath.length === 1)
      return this.initialPath;
    throw new Error('Container is no longer attached');
  }
  protected prepare() {
    if (this.doc && this.initialPath.length === 1 && !this.objectId) {
      this.doc.ensureRoot(
        String(this.initialPath[0]),
        this instanceof AutomergeText
          ? 'text'
          : this instanceof AutomergeList
            ? 'list'
            : 'map'
      );
      this.objectId =
        A.getObjectId(this.doc.current, this.initialPath[0]) ?? undefined;
    }
  }
  getAttached() {
    return this.doc ? this : undefined;
  }
  isAttached() {
    return !!this.doc;
  }
  parent() {
    if (!this.doc || this.path.length <= 1) return undefined;
    const path = this.path.slice(0, -1);
    if (
      path.at(-1) === 'items' &&
      isList(atPath(this.doc.current, path.slice(0, -1)))
    )
      path.pop();
    return this.doc.wrap(path);
  }
  toJSON(): any {
    return this.doc
      ? plain(
          atPath(this.doc.current, this.path) ??
            (this instanceof AutomergeList ? emptyList() : {})
        )
      : {};
  }
  abstract kind(): ContainerType;
}
export type Container =
  | AutomergeMap
  | AutomergeList
  | AutomergeMovableList
  | AutomergeText
  | AutomergeCounter;
export class AutomergeMap extends BaseContainer {
  kind(): ContainerType {
    return 'Map';
  }
  get(key: string): any {
    const path = [...this.path, key];
    const value = atPath(this.doc?.current, path);
    return value instanceof A.ImmutableString
      ? value.toString()
      : (this.doc?.wrap(path) ?? value);
  }
  set(key: string, value: Value) {
    this.prepare();
    this.doc?.mutate((draft) => {
      const parent = atPath(draft, this.path);
      // Explicit same-value writes carry authorship for undo conflict checks.
      if (plain(parent[key]) === value) delete parent[key];
      parent[key] = scalar(value);
    });
  }
  delete(key: string) {
    this.prepare();
    this.doc?.mutate((draft) => {
      const parent = atPath(draft, this.path);
      // Record an explicit clear even when another replica already cleared it.
      if (parent[key] === undefined) parent[key] = null;
      delete parent[key];
    });
  }
  getOrCreateContainer<T extends Container>(key: string, container: T): T {
    const existing = this.get(key);
    if (existing instanceof BaseContainer) return existing as T;
    return this.setContainer(key, container);
  }
  setContainer<T extends Container>(key: string, container: T): T {
    this.prepare();
    this.doc?.mutate((draft) => {
      atPath(draft, this.path)[key] =
        container instanceof AutomergeText
          ? ''
          : container instanceof AutomergeList
            ? emptyList()
            : container instanceof AutomergeCounter
              ? new A.Counter(0)
              : {};
    });
    return this.get(key);
  }
  getShallowValue(): Record<string, any> {
    return Object.fromEntries(
      this.keys().map((key) => {
        const value = this.get(key);
        return [key, value instanceof BaseContainer ? value.id : value];
      })
    );
  }
  keys() {
    return Object.keys(atPath(this.doc?.current, this.path) ?? {});
  }
  values() {
    return this.keys().map((key) => this.get(key));
  }
  entries() {
    return this.keys().map((key) => [key, this.get(key)] as const);
  }
  get size() {
    return this.keys().length;
  }
  getLastEditor(key: string) {
    if (!this.doc) return undefined;
    const object = atPath(this.doc.current, this.path);
    const conflicts = A.getConflicts(object, key);
    const op = conflicts && Object.keys(conflicts).at(-1);
    if (op) return BigInt(`0x${op.split('@')[1]}`).toString();
    const candidates = new Map<string, string>();
    let deletedBy: string | undefined;
    for (const bytes of A.getAllChanges(this.doc.value)) {
      const change = A.decodeChange(bytes);
      for (const [index, operation] of change.ops.entries()) {
        if (operation.obj !== this.id || operation.key !== key) continue;
        for (const predecessor of operation.pred)
          candidates.delete(predecessor);
        deletedBy = change.actor;
        if (operation.action !== 'del')
          candidates.set(
            `${change.startOp + index}@${change.actor}`,
            change.actor
          );
      }
    }
    const winner =
      [...candidates]
        .sort(
          ([left], [right]) =>
            Number(left.split('@')[0]) - Number(right.split('@')[0]) ||
            left.localeCompare(right)
        )
        .at(-1)?.[1] ?? deletedBy;
    return winner ? BigInt(`0x${winner}`).toString() : undefined;
  }
}
export class AutomergeList extends BaseContainer {
  kind(): ContainerType {
    return 'List';
  }
  protected keys() {
    const list = atPath(this.doc?.current, this.path);
    return list ? listKeys(list) : [];
  }
  protected itemPath(index: number) {
    return [...this.path, 'items', this.keys()[index]];
  }
  get length() {
    return this.keys().length;
  }
  get(index: number): any {
    const path = this.itemPath(index);
    const value = atPath(this.doc?.current, path);
    return value instanceof A.ImmutableString
      ? value.toString()
      : (this.doc?.wrap(path) ?? value);
  }
  protected insertValue(index: number, value: any) {
    if (index < 0 || index > this.length)
      throw new RangeError('List index out of range');
    this.prepare();
    const key = crypto.randomUUID();
    const next = this.keys()[index];
    this.doc?.mutate((draft) => {
      const list = atPath(draft, this.path);
      list.items[key] = value;
      const position = next
        ? list.order.findIndex((id: any) => String(id) === next)
        : list.order.length;
      list.order.splice(position, 0, new A.ImmutableString(key));
    });
  }
  insert(index: number, value: Value) {
    this.insertValue(index, scalar(value));
  }
  push(value: Value) {
    this.insert(this.length, value);
  }
  delete(index: number, count = 1) {
    const keys = new Set(this.keys().slice(index, index + count));
    this.doc?.mutate((draft) => {
      const list = atPath(draft, this.path);
      for (let i = list.order.length - 1; i >= 0; i--)
        if (keys.has(String(list.order[i]))) list.order.splice(i, 1);
    });
  }
  insertContainer<T extends Container>(index: number, container: T): T {
    this.insertValue(
      index,
      container instanceof AutomergeText
        ? ''
        : container instanceof AutomergeList
          ? emptyList()
          : {}
    );
    return this.get(index);
  }
  pushContainer<T extends Container>(container: T): T {
    return this.insertContainer(this.length, container);
  }
  getShallowValue() {
    return Array.from({ length: this.length }, (_, i) => {
      const value = this.get(i);
      return value instanceof BaseContainer ? value.id : value;
    });
  }
  getCursor(offset: number) {
    return new Cursor(this.id, '', offset, this.keys()[offset]);
  }
}
export class AutomergeMovableList extends AutomergeList {
  kind(): ContainerType {
    return 'MovableList';
  }
  move(from: number, to: number) {
    const keys = this.keys();
    if (from < 0 || from >= keys.length || to < 0 || to >= keys.length)
      throw new RangeError('List index out of range');
    const [key] = keys.splice(from, 1);
    keys.splice(to, 0, key);
    this.doc?.mutate((draft) => {
      const list = atPath(draft, this.path);
      for (let i = list.order.length - 1; i >= 0; i--)
        if (String(list.order[i]) === key) list.order.splice(i, 1);
      const next = keys[to + 1];
      const position = next
        ? list.order.findIndex((id: any) => String(id) === next)
        : list.order.length;
      list.order.splice(position, 0, new A.ImmutableString(key));
    });
  }
  set(index: number, value: Value) {
    this.doc?.mutate((draft) => {
      atPath(draft, this.path).items[this.keys()[index]] = scalar(value);
    });
  }
}
export class AutomergeText extends BaseContainer {
  kind(): ContainerType {
    return 'Text';
  }
  toString() {
    return atPath(this.doc?.current, this.path) ?? '';
  }
  toJSON() {
    return this.toString();
  }
  get length() {
    return this.toString().length;
  }
  insert(index: number, value: string) {
    this.prepare();
    this.doc?.mutate((draft) => A.splice(draft, this.path, index, 0, value));
  }
  push(value: string) {
    this.insert(this.length, value);
  }
  delete(index: number, count: number) {
    this.doc?.mutate((draft) => A.splice(draft, this.path, index, count, ''));
  }
  update(value: string) {
    this.prepare();
    this.doc?.mutate((draft) => A.updateText(draft, this.path, value));
  }
  getCursor(index: number): Cursor {
    if (!this.doc) throw new Error('Detached text');
    return new Cursor(this.id, A.getCursor(this.doc.current, this.path, index));
  }
}
export class AutomergeCounter extends BaseContainer {
  kind(): ContainerType {
    return 'Counter';
  }
  increment(value: number) {
    this.doc?.mutate((draft) => atPath(draft, this.path).increment(value));
  }
  get value() {
    return Number(atPath(this.doc?.current, this.path) ?? 0);
  }
}
export function isContainer(value: unknown): value is Container {
  return value instanceof BaseContainer;
}
export { A as Automerge };
