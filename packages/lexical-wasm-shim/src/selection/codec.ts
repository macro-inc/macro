import {
  type CompatOperation,
  CompatPointKind,
  CompatSelectionData,
  type ICompatPoint,
  type ICompatReply,
  type IForeignCallbackValue,
  type IForeignSelectionRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type { LexicalNode } from '../nodes';
import { NodeSelection } from './node';
import type { PointType } from './point';
import { $createPoint } from './point';
import { RangeSelection } from './range';
import type {
  BaseSelection,
  RawSelectionPoint,
  RawTableSelectionValue,
  SelectionArgument,
  SelectionValue,
} from './runtime';
import { getSelectionRuntime, type SelectionRuntime } from './runtime';

const captures = new WeakMap<
  SelectionRuntime,
  Map<string, WeakRef<SelectionValue>>
>();
const collected = new FinalizationRegistry<{
  cache: Map<string, WeakRef<SelectionValue>>;
  key: string;
  reference: WeakRef<SelectionValue>;
}>(({ cache, key, reference }) => {
  if (cache.get(key) === reference) {
    cache.delete(key);
  }
});

function identity(reference: IForeignSelectionRef): string {
  return `${reference.editorId}:${reference.version}:${reference.selectionId}`;
}

export function bindSelectionReference(
  selection: SelectionValue,
  reference: IForeignSelectionRef
): void {
  if (reference.selectionId === 0) {
    throw new Error('Native selection references must have a nonzero identity');
  }
  validateSelectionClass(selection);
  const runtime = getSelectionRuntime();
  let cache = captures.get(runtime);
  if (cache === undefined) {
    cache = new Map();
    captures.set(runtime, cache);
  }
  const key = identity(reference);
  const existing = cache.get(key)?.deref();
  if (existing !== undefined && existing !== selection) {
    throw new Error(
      'Native selection reference already has a captured JS instance'
    );
  }
  if (existing === undefined) {
    const reference = new WeakRef(selection);
    cache.set(key, reference);
    collected.register(selection, { cache, key, reference });
  }
  runtime.bindSelection(selection, reference);
}

export function selectionFromReference(
  reference: IForeignSelectionRef
): SelectionValue | undefined {
  return captures.get(getSelectionRuntime())?.get(identity(reference))?.deref();
}

export function selectionFromNativeValue(
  value: IForeignCallbackValue
): SelectionValue | null {
  const data = value.data;
  if (data.discriminator === 1 && data.value.value.data.discriminator === 3) {
    return null;
  }
  if (data.discriminator !== 3) {
    throw new Error('Native callback value is not a selection');
  }
  const selection = selectionFromReference(data.value.value);
  if (selection === undefined) {
    throw new Error('Native selection value has no captured snapshot');
  }
  return selection;
}

export function utf16(text: string): number[] {
  return Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index)
  );
}

export function fromUtf16(units: readonly number[]): string {
  let result = '';
  for (const unit of units) {
    result += String.fromCharCode(unit);
  }
  return result;
}

function encodePoint(point: RawSelectionPoint): ICompatPoint {
  return {
    key: getSelectionRuntime().nativeKey(point.key),
    offset: point.offset,
    kind:
      point.type === 'text' ? CompatPointKind.Text : CompatPointKind.Element,
  };
}

function decodePoint(point: ICompatPoint): PointType {
  if (
    point.kind !== CompatPointKind.Text &&
    point.kind !== CompatPointKind.Element
  ) {
    throw new Error('Invalid native selection point kind');
  }
  return $createPoint(
    getSelectionRuntime().publicKey(point.key),
    point.offset,
    point.kind === CompatPointKind.Text ? 'text' : 'element'
  );
}

function updatePoint(target: RawSelectionPoint, source: ICompatPoint): void {
  const decoded = decodePoint(source);
  if (
    target.key === decoded.key &&
    target.offset === decoded.offset &&
    target.type === decoded.type
  )
    return;
  target.key = decoded.key;
  target.offset = decoded.offset;
  target.type = decoded.type;
}

export function validateSelectionClass(selection: SelectionValue): void {
  if (
    !(selection instanceof RangeSelection) &&
    !(selection instanceof NodeSelection) &&
    !getSelectionRuntime().isTableSelection(selection)
  ) {
    throw new Error('Unsupported selection class');
  }
}

export function selectionToSnapshot(
  selection: SelectionValue | null
): CompatSelectionData {
  if (selection === null) {
    return CompatSelectionData.fromCompatNoSelection({});
  }
  validateSelectionClass(selection);
  const runtime = getSelectionRuntime();
  const reference = runtime.selectionRef(selection);
  if (reference === undefined) {
    throw new Error('Selection has no native reference');
  }
  const cached = selection._cachedNodes;
  const common = {
    reference,
    dirty: selection.dirty,
    hasCachedNodes: cached !== null,
    cachedNodes:
      cached === null
        ? []
        : cached.map((node) => {
            if (!runtime.isLexicalNode(node))
              throw new Error('Selection cache contains a non-core node');
            return runtime.nodeReference(node);
          }),
  };
  if (selection instanceof RangeSelection) {
    return CompatSelectionData.fromCompatRangeSelection({
      ...common,
      anchor: encodePoint(selection.anchor),
      focus: encodePoint(selection.focus),
      format: selection.format,
      style: utf16(selection.style),
      hasCachedBackward: selection._cachedIsBackward !== null,
      cachedBackward: selection._cachedIsBackward ?? false,
    });
  }
  if (selection instanceof NodeSelection) {
    return CompatSelectionData.fromCompatNodeSelection({
      ...common,
      keys: Array.from(selection._nodes, (key) => runtime.nativeKey(key)),
    });
  }
  if (runtime.isTableSelection(selection)) {
    return CompatSelectionData.fromCompatTableSelection({
      ...common,
      tableKey: runtime.nativeKey(selection.tableKey),
      anchor: encodePoint(selection.anchor),
      focus: encodePoint(selection.focus),
    });
  }
  throw new Error('Unsupported selection class');
}

export function selectionFromSnapshot(
  snapshot: CompatSelectionData
): SelectionValue | null {
  const data = snapshot.data;
  if (data.discriminator === 1) {
    return null;
  }
  const runtime = getSelectionRuntime();
  const record = data.value;
  const existing = captures
    .get(runtime)
    ?.get(identity(record.reference))
    ?.deref();
  if (existing !== undefined && Object.isFrozen(existing)) {
    if (
      (data.discriminator === 2 && !(existing instanceof RangeSelection)) ||
      (data.discriminator === 3 && !(existing instanceof NodeSelection)) ||
      (data.discriminator === 4 && !runtime.isTableSelection(existing))
    ) {
      throw new Error(
        'Native selection changed class for an existing reference'
      );
    }
    return existing;
  }
  let selection: RangeSelection | NodeSelection | RawTableSelectionValue;
  if (data.discriminator === 2) {
    const range = data.value;
    if (existing !== undefined && !(existing instanceof RangeSelection)) {
      throw new Error(
        'Native selection changed class for an existing reference'
      );
    }
    selection =
      existing ??
      new RangeSelection(
        decodePoint(range.anchor),
        decodePoint(range.focus),
        range.format,
        fromUtf16(range.style)
      );
    updatePoint(selection.anchor, range.anchor);
    updatePoint(selection.focus, range.focus);
    selection.format = range.format;
    selection.style = fromUtf16(range.style);
    selection._cachedIsBackward = range.hasCachedBackward
      ? range.cachedBackward
      : null;
  } else if (data.discriminator === 3) {
    if (existing !== undefined && !(existing instanceof NodeSelection)) {
      throw new Error(
        'Native selection changed class for an existing reference'
      );
    }
    selection = existing ?? new NodeSelection(new Set());
    const keys = data.value.keys.map((key) => runtime.publicKey(key));
    const previousKeys = Array.from(selection._nodes);
    if (
      previousKeys.length !== keys.length ||
      previousKeys.some((key, index) => key !== keys[index])
    ) {
      selection._nodes = new Set(keys);
    }
  } else {
    if (existing !== undefined && !runtime.isTableSelection(existing)) {
      throw new Error(
        'Native selection changed class for an existing reference'
      );
    }
    selection = existing ?? runtime.createTableSelection();
    selection.tableKey = runtime.publicKey(data.value.tableKey);
    updatePoint(selection.anchor, data.value.anchor);
    updatePoint(selection.focus, data.value.focus);
  }
  selection.dirty = record.dirty;
  const cached = record.hasCachedNodes
    ? record.cachedNodes.map((reference) => runtime.resolveNode(reference))
    : null;
  const previousCache = selection._cachedNodes;
  const unchangedCache =
    cached === previousCache ||
    (cached !== null &&
      previousCache !== null &&
      cached.length === previousCache.length &&
      cached.every((node, index) => node === previousCache[index]));
  if (!unchangedCache) selection._cachedNodes = cached;
  bindSelectionReference(selection, record.reference);
  return selection;
}

export function captureReplySelections(reply: ICompatReply): void {
  for (const snapshot of reply.selections) {
    selectionFromSnapshot(snapshot);
  }
}

export function callSelection(
  selection: BaseSelection,
  operation: CompatOperation,
  args: readonly SelectionArgument[] = []
): IForeignCallbackValue {
  validateSelectionClass(selection);
  const reply = getSelectionRuntime().invokeSelection(
    selection,
    operation,
    args
  );
  captureReplySelections(reply);
  return reply.value;
}

export function booleanArgument(value: boolean): IForeignCallbackValue {
  return { data: { discriminator: 8, value: { value } } };
}

export function textArgument(value: string): IForeignCallbackValue {
  return { data: { discriminator: 10, value: { value: utf16(value) } } };
}

export function numberArgument(value: number): IForeignCallbackValue {
  return { data: { discriminator: 9, value: { value } } };
}

export function nodesArgument(
  nodes: readonly LexicalNode[]
): SelectionArgument {
  return { kind: 'nodes', nodes: [...nodes] };
}

export function nodeArrayResult(value: IForeignCallbackValue): LexicalNode[] {
  if (value.data.discriminator !== 7) {
    throw new Error('Native selection operation returned a non-node array');
  }
  return value.data.value.values.map((reference) =>
    getSelectionRuntime().resolveNode(reference)
  );
}

export function booleanResult(value: IForeignCallbackValue): boolean {
  if (value.data.discriminator !== 8) {
    throw new Error('Native selection operation returned a non-boolean');
  }
  return value.data.value.value;
}
