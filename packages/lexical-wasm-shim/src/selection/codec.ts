import type { TableSelection } from '@lexical/table';
import {
  CompatOperation,
  CompatPointKind,
  CompatSelectionData,
  CompatSelectionPatch,
  type ICompatPoint,
  type ICompatReply,
  type IForeignCallbackValue,
  type IForeignSelectionRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type { BaseSelection, LexicalNode, PointType } from 'lexical';
import { NodeSelection } from './node';
import { $createPoint } from './point';
import { RangeSelection } from './range';
import { getSelectionRuntime, type SelectionRuntime } from './runtime';

const captures = new WeakMap<
  SelectionRuntime,
  Map<string, WeakRef<BaseSelection>>
>();
const collected = new FinalizationRegistry<{
  cache: Map<string, WeakRef<BaseSelection>>;
  key: string;
  reference: WeakRef<BaseSelection>;
}>(({ cache, key, reference }) => {
  if (cache.get(key) === reference) {
    cache.delete(key);
  }
});

function identity(reference: IForeignSelectionRef): string {
  return `${reference.editorId}:${reference.version}:${reference.selectionId}`;
}

export function bindSelectionReference(
  selection: BaseSelection,
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
): BaseSelection | undefined {
  return captures.get(getSelectionRuntime())?.get(identity(reference))?.deref();
}

export function selectionFromNativeValue(
  value: IForeignCallbackValue
): BaseSelection | null {
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

function encodePoint(point: PointType): ICompatPoint {
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

function updatePoint(target: PointType, source: ICompatPoint): void {
  const decoded = decodePoint(source);
  target.key = decoded.key;
  target.offset = decoded.offset;
  target.type = decoded.type;
}

export function validateSelectionClass(selection: BaseSelection): void {
  if (
    !(selection instanceof RangeSelection) &&
    !(selection instanceof NodeSelection) &&
    !getSelectionRuntime().isTableSelection(selection)
  ) {
    throw new Error('Unsupported selection class');
  }
}

export function selectionToSnapshot(
  selection: BaseSelection | null
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
  const cached = selection.getCachedNodes();
  const common = {
    reference,
    dirty: selection.dirty,
    hasCachedNodes: cached !== null,
    cachedNodes:
      cached === null ? [] : cached.map((node) => runtime.nodeReference(node)),
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
): BaseSelection | null {
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
  let selection: RangeSelection | NodeSelection | TableSelection;
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
    selection._nodes = new Set(
      data.value.keys.map((key) => runtime.publicKey(key))
    );
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
  selection._cachedNodes = record.hasCachedNodes
    ? record.cachedNodes.map((reference) => runtime.resolveNode(reference))
    : null;
  bindSelectionReference(selection, record.reference);
  return selection;
}

export function captureReplySelections(reply: ICompatReply): void {
  for (const snapshot of reply.selections) {
    selectionFromSnapshot(snapshot);
  }
}

export function ensureSelectionReference(
  selection: BaseSelection
): IForeignSelectionRef {
  const runtime = getSelectionRuntime();
  validateSelectionClass(selection);
  const existing = runtime.selectionRef(selection);
  if (existing !== undefined) {
    return existing;
  }
  let operation: CompatOperation;
  if (selection instanceof RangeSelection) {
    operation = CompatOperation.CreateRangeSelection;
  } else if (selection instanceof NodeSelection) {
    operation = CompatOperation.CreateNodeSelection;
  } else {
    operation = CompatOperation.CreateTableSelection;
  }
  const reply = runtime.invoke(operation, []);
  const data = reply.value.data;
  if (data.discriminator !== 3) {
    throw new Error('Native selection construction returned a non-selection');
  }
  // Adopt before decoding: a pure JS constructor already supplied this instance.
  bindSelectionReference(selection, data.value.value);
  return data.value.value;
}

export function writeSelection(
  selection: BaseSelection | null,
  activate: boolean
): void {
  const runtime = getSelectionRuntime();
  if (selection !== null) {
    ensureSelectionReference(selection);
  }
  const reply = runtime.writeSelection(
    new CompatSelectionPatch({
      historical: runtime.isReadOnly(),
      stateVersion: runtime.getActiveStateVersion(),
      activate,
      selection: selectionToSnapshot(selection),
    })
  );
  captureReplySelections(reply);
}

export function callSelection(
  selection: BaseSelection,
  operation: CompatOperation,
  args: readonly IForeignCallbackValue[] = []
): IForeignCallbackValue {
  const reference = ensureSelectionReference(selection);
  if (!Object.isFrozen(selection)) {
    writeSelection(selection, false);
  }
  const reply = getSelectionRuntime().invoke(operation, args, reference);
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

export function nodesArgument(nodes: LexicalNode[]): IForeignCallbackValue {
  return {
    data: {
      discriminator: 7,
      value: {
        values: nodes.map((node) => getSelectionRuntime().nodeReference(node)),
      },
    },
  };
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
