import {
  CompatOperation,
  CompatPointKind,
  type CompatReply,
  CompatSelectionData,
  CompatSelectionPatch,
  type ICompatPoint,
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

export function selectionToSnapshot(
  selection: BaseSelection | null
): CompatSelectionData {
  if (selection === null) {
    return CompatSelectionData.fromCompatNoSelection({});
  }
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
    return existing;
  }
  let selection: RangeSelection | NodeSelection;
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
    for (const [target, source] of [
      [selection.anchor, range.anchor],
      [selection.focus, range.focus],
    ] satisfies [PointType, ICompatPoint][]) {
      const decoded = decodePoint(source);
      target.key = decoded.key;
      target.offset = decoded.offset;
      target.type = decoded.type;
    }
    selection.format = range.format;
    selection.style = fromUtf16(range.style);
    selection._cachedIsBackward = range.hasCachedBackward
      ? range.cachedBackward
      : null;
  } else {
    if (existing !== undefined && !(existing instanceof NodeSelection)) {
      throw new Error(
        'Native selection changed class for an existing reference'
      );
    }
    selection = existing ?? new NodeSelection(new Set());
    selection._nodes = new Set(
      data.value.keys.map((key) => runtime.publicKey(key))
    );
  }
  selection.dirty = record.dirty;
  selection._cachedNodes = record.hasCachedNodes
    ? record.cachedNodes.map((reference) => runtime.resolveNode(reference))
    : null;
  bindSelectionReference(selection, record.reference);
  return selection;
}

export function captureReplySelections(reply: CompatReply): void {
  for (const snapshot of reply.selections) {
    selectionFromSnapshot(snapshot);
  }
}

export function ensureSelectionReference(
  selection: BaseSelection
): IForeignSelectionRef {
  const runtime = getSelectionRuntime();
  const existing = runtime.selectionRef(selection);
  if (existing !== undefined) {
    return existing;
  }
  const operation =
    selection instanceof RangeSelection
      ? CompatOperation.CreateRangeSelection
      : CompatOperation.CreateNodeSelection;
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
  const reference =
    selection === null ? undefined : ensureSelectionReference(selection);
  const reply = runtime.writeSelection(
    new CompatSelectionPatch({
      historical: runtime.isReadOnly(),
      stateVersion: reference?.version ?? 0n,
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
