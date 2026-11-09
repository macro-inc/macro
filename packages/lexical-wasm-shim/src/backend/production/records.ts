import type {
  IForeignCallbackValue,
  IForeignNodeRef,
  IForeignRecordRef,
  IForeignRenderRecord,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { foreignNativeFields } from '@macro-inc/collaboration/session/foreign-native-fields.generated';
import { fromUtf16, publicKey, safeNumber } from './values';

interface Capture {
  readonly handle: number;
  readonly data: IForeignRenderRecord;
  readonly fields: ReadonlyMap<string, IForeignCallbackValue>;
}

const nativeFields = new Map<number, string>(
  foreignNativeFields.map((field) => [field.id, field.property])
);

function instanceIdentity(node: IForeignNodeRef): string {
  return `${node.instanceOwnerId}:${node.classId}:${node.instanceId}`;
}

function nodeIdentity(node: IForeignNodeRef): string {
  return `${node.editorId}:${node.version}:${node.key.index}:${node.key.generation}:${node.instanceOwnerId}:${node.classId}:${node.instanceId}`;
}

function sameAuthority(
  left: IForeignRecordRef,
  right: IForeignRecordRef
): boolean {
  return (
    left.captureId === right.captureId &&
    nodeIdentity(left.node) === nodeIdentity(right.node) &&
    left.updateId === right.updateId &&
    left.access === right.access
  );
}

/** Captures are scoped by native identity, never an allocation address. */
export class CapturedRecords {
  private next = 0;
  private readonly byCapture = new Map<bigint, Capture>();
  private readonly byHandle = new Map<number, Capture>();
  private readonly byInstance = new Map<string, number>();
  private readonly handleIdentities = new Map<number, string>();
  private readonly versions = new Map<bigint, Set<bigint>>();
  private readonly retiredVersions = new Set<bigint>();
  private readonly handleCaptures = new Map<number, Set<bigint>>();
  private readonly replyNodes = new WeakMap<
    readonly IForeignRenderRecord[],
    ReadonlyMap<string, IForeignRecordRef>
  >();

  constructor(
    private readonly changed: (
      handle: number,
      previous: IForeignRecordRef | undefined,
      next: IForeignRecordRef
    ) => void
  ) {}

  accept(records: readonly IForeignRenderRecord[]): void {
    const index = new Map<string, IForeignRecordRef>();
    for (const data of records) {
      const captureId = data.record.captureId;
      if (captureId === 0n) throw new Error('Native capture has no identity');
      const identity = nodeIdentity(data.record.node);
      const previous = index.get(identity);
      if (previous !== undefined && previous.captureId !== captureId)
        throw new Error('Native reply has ambiguous node captures');
      index.set(identity, data.record);
      this.acceptOne(data);
    }
    this.replyNodes.set(records, index);
  }

  private acceptOne(data: IForeignRenderRecord, preferred?: number): Capture {
    const reference = data.record;
    if (reference.captureId === 0n)
      throw new Error('Native capture has no identity');
    const existing = this.byCapture.get(reference.captureId);
    if (existing) {
      if (preferred !== undefined && existing.handle !== preferred)
        throw new Error(
          'Hydrated capture was already exposed with another handle'
        );
      if (!sameAuthority(existing.data.record, reference))
        throw new Error('Native capture authority changed');
      return existing;
    }
    const node = reference.node;
    const identity = data.hasInstance ? instanceIdentity(node) : undefined;
    if (
      data.hasInstance &&
      (node.instanceOwnerId === 0 ||
        node.classId === 0 ||
        node.instanceId === 0)
    )
      throw new Error('Hydrated native instance has no identity');
    const known =
      identity === undefined ? undefined : this.byInstance.get(identity);
    if (preferred !== undefined && known !== undefined && known !== preferred)
      throw new Error('Native instance is already bound to another JS handle');
    const handle = preferred ?? known ?? this.next++;
    const previous = this.byHandle.get(handle);
    if (
      previous &&
      (previous.data.record.node.editorId !== node.editorId ||
        previous.data.record.node.key.index !== node.key.index ||
        previous.data.record.node.key.generation !== node.key.generation ||
        previous.data.typeName !== data.typeName)
    )
      throw new Error('Native instance changed editor, node key or type');
    const fields = new Map<string, IForeignCallbackValue>();
    for (const field of data.nativeProjection.fields) {
      const property = nativeFields.get(field.field);
      if (property === undefined || fields.has(property))
        throw new Error(
          'Native projection contains an unknown or duplicate field'
        );
      fields.set(property, field.value);
    }
    const capture = { handle, data, fields };
    this.byCapture.set(reference.captureId, capture);
    this.byHandle.set(handle, capture);
    if (identity !== undefined) {
      this.byInstance.set(identity, handle);
      this.handleIdentities.set(handle, identity);
    }
    let version = this.versions.get(node.version);
    if (version === undefined) {
      version = new Set();
      this.versions.set(node.version, version);
    }
    version.add(reference.captureId);
    let handles = this.handleCaptures.get(handle);
    if (handles === undefined) {
      handles = new Set();
      this.handleCaptures.set(handle, handles);
    }
    handles.add(reference.captureId);
    this.changed(handle, previous?.data.record, reference);
    return capture;
  }

  /** Native hydration changes authority, while preserving the actual JS object. */
  bind(handle: number, data: IForeignRenderRecord): void {
    const previous = this.capture(handle).data;
    if (
      previous.hasInstance ||
      !data.hasInstance ||
      previous.record.node.editorId !== data.record.node.editorId ||
      previous.record.node.version !== data.record.node.version
    )
      throw new Error('Invalid captured instance hydration');
    if (data.record.captureId === previous.record.captureId)
      throw new Error('Hydration must issue a new capture authority');
    this.acceptOne(data, handle);
  }
  reference(handle: number): IForeignRecordRef {
    return this.capture(handle).data.record;
  }
  handle(reference: IForeignRecordRef): number {
    return this.resolve(reference).handle;
  }
  private resolve(reference: IForeignRecordRef): Capture {
    const capture = this.byCapture.get(reference.captureId);
    if (capture === undefined)
      throw new Error('Native node capture was released');
    if (!sameAuthority(capture.data.record, reference))
      throw new Error('Native capture authority mismatch');
    return capture;
  }
  private capture(handle: number): Capture {
    const capture = this.byHandle.get(handle);
    if (capture === undefined)
      throw new Error('Native node capture was released');
    return capture;
  }
  raw(reference: IForeignRecordRef): unknown {
    const capture = this.resolve(reference);
    const node = capture.data.record.node;
    return {
      $h: capture.handle,
      key: publicKey(node.key),
      type: capture.data.typeName,
      ver: safeNumber(node.version),
    };
  }
  rawNode(
    node: IForeignNodeRef,
    records: readonly IForeignRenderRecord[]
  ): unknown {
    const found = this.replyNodes.get(records)?.get(nodeIdentity(node));
    if (found === undefined)
      throw new Error('Native result lacks a node record');
    return this.raw(found);
  }
  field(
    handle: number,
    name: string,
    decode: (value: IForeignCallbackValue) => unknown
  ): unknown {
    const capture = this.capture(handle);
    const data = capture.data;
    const { links, base } = data;
    const text = base.text;
    const element = base.element;
    switch (name) {
      case '__key':
        return publicKey(data.record.node.key);
      case '__type':
        return data.typeName;
      case '__parent':
        return links.parent.present ? publicKey(links.parent.key) : null;
      case '__prev':
        return links.previous.present ? publicKey(links.previous.key) : null;
      case '__next':
        return links.next.present ? publicKey(links.next.key) : null;
      case '__first':
        return links.first.present ? publicKey(links.first.key) : null;
      case '__last':
        return links.last.present ? publicKey(links.last.key) : null;
      case '__size':
        return links.size;
      case '__format':
        return text?.format ?? element?.format;
      case '__style':
        return text?.style ?? element?.style;
      case '__text':
        return text?.text === undefined ? undefined : fromUtf16(text.text);
      case '__detail':
        return text?.detail;
      case '__mode':
        return text?.mode;
      case '__indent':
        return element?.indent;
      case '__dir':
        return element?.direction === 1
          ? 'ltr'
          : element?.direction === 2
            ? 'rtl'
            : null;
      case '__textFormat':
        return element?.textFormat;
      case '__textStyle':
        return element?.textStyle;
      case '__cachedText':
        return data.hasRootCachedText ? fromUtf16(data.rootCachedText) : null;
    }
    const field = capture.fields.get(name);
    if (field !== undefined) return decode(field);
    throw new Error(`Native capture has no field ${name}`);
  }
  release(
    version: bigint,
    retained: (record: IForeignRecordRef) => boolean
  ): void {
    this.retiredVersions.add(version);
    for (const id of this.versions.get(version) ?? []) this.prune(id, retained);
    this.clearEmptyVersion(version);
  }

  /** A capture lease may outlive the graph which originally issued its ref. */
  prune(
    captureId: bigint,
    retained: (record: IForeignRecordRef) => boolean
  ): void {
    const capture = this.byCapture.get(captureId);
    if (
      !capture ||
      !this.retiredVersions.has(capture.data.record.node.version) ||
      retained(capture.data.record)
    )
      return;
    this.byCapture.delete(captureId);
    this.versions.get(capture.data.record.node.version)?.delete(captureId);
    this.clearEmptyVersion(capture.data.record.node.version);
    const handles = this.handleCaptures.get(capture.handle);
    handles?.delete(captureId);
    if (this.byHandle.get(capture.handle) !== capture) return;
    let replacement: Capture | undefined;
    for (const id of handles ?? []) replacement = this.byCapture.get(id);
    if (replacement) {
      this.byHandle.set(capture.handle, replacement);
      return;
    }
    this.byHandle.delete(capture.handle);
    this.handleCaptures.delete(capture.handle);
    const identity = this.handleIdentities.get(capture.handle);
    if (identity !== undefined) this.byInstance.delete(identity);
    this.handleIdentities.delete(capture.handle);
  }

  private clearEmptyVersion(version: bigint): void {
    if ((this.versions.get(version)?.size ?? 0) !== 0) return;
    this.versions.delete(version);
    this.retiredVersions.delete(version);
  }
}
