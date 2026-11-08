import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as abi from './abi.generated';

const codecs: Record<string, (bytes: Uint8Array) => Uint8Array> = {
  SessionConfigMsg: (bytes) =>
    abi.SessionConfigMsg.encode(abi.SessionConfigMsg.decode(bytes)),
  PointMsg: (bytes) => abi.PointMsg.encode(abi.PointMsg.decode(bytes)),
  SelectionMsg: (bytes) =>
    abi.SelectionMsg.encode(abi.SelectionMsg.decode(bytes)),
  ClipboardEntryMsg: (bytes) =>
    abi.ClipboardEntryMsg.encode(abi.ClipboardEntryMsg.decode(bytes)),
  ModifyTargetMsg: (bytes) =>
    abi.ModifyTargetMsg.encode(abi.ModifyTargetMsg.decode(bytes)),
  MarkedSelectionMsg: (bytes) =>
    abi.MarkedSelectionMsg.encode(abi.MarkedSelectionMsg.decode(bytes)),
  RangeSelectionMsg: (bytes) =>
    abi.RangeSelectionMsg.encode(abi.RangeSelectionMsg.decode(bytes)),
  PathStepMsg: (bytes) => abi.PathStepMsg.encode(abi.PathStepMsg.decode(bytes)),
  ContainerPathMsg: (bytes) =>
    abi.ContainerPathMsg.encode(abi.ContainerPathMsg.decode(bytes)),
  DocValueNode: (bytes) =>
    abi.DocValueNode.encode(abi.DocValueNode.decode(bytes)),
  DocOpMsg: (bytes) => abi.DocOpMsg.encode(abi.DocOpMsg.decode(bytes)),
  SessionInputMsg: (bytes) =>
    abi.SessionInputMsg.encode(abi.SessionInputMsg.decode(bytes)),
  ConnectMsg: (bytes) => abi.ConnectMsg.encode(abi.ConnectMsg.decode(bytes)),
  WalRecordMsg: (bytes) =>
    abi.WalRecordMsg.encode(abi.WalRecordMsg.decode(bytes)),
  OwnerRowsMsg: (bytes) =>
    abi.OwnerRowsMsg.encode(abi.OwnerRowsMsg.decode(bytes)),
  LocalStateMsg: (bytes) =>
    abi.LocalStateMsg.encode(abi.LocalStateMsg.decode(bytes)),
  StorageOpMsg: (bytes) =>
    abi.StorageOpMsg.encode(abi.StorageOpMsg.decode(bytes)),
  AttrMsg: (bytes) => abi.AttrMsg.encode(abi.AttrMsg.decode(bytes)),
  TelemetryMsg: (bytes) =>
    abi.TelemetryMsg.encode(abi.TelemetryMsg.decode(bytes)),
  NodeCursorMsg: (bytes) =>
    abi.NodeCursorMsg.encode(abi.NodeCursorMsg.decode(bytes)),
  DocEventMsg: (bytes) => abi.DocEventMsg.encode(abi.DocEventMsg.decode(bytes)),
  ViewEffectMsg: (bytes) =>
    abi.ViewEffectMsg.encode(abi.ViewEffectMsg.decode(bytes)),
  QueryMsg: (bytes) => abi.QueryMsg.encode(abi.QueryMsg.decode(bytes)),
  QueryReplyMsg: (bytes) =>
    abi.QueryReplyMsg.encode(abi.QueryReplyMsg.decode(bytes)),
  ClipboardMsg: (bytes) =>
    abi.ClipboardMsg.encode(abi.ClipboardMsg.decode(bytes)),
  TypeRowMsg: (bytes) => abi.TypeRowMsg.encode(abi.TypeRowMsg.decode(bytes)),
  TypeTableMsg: (bytes) =>
    abi.TypeTableMsg.encode(abi.TypeTableMsg.decode(bytes)),
  ListenerRowMsg: (bytes) =>
    abi.ListenerRowMsg.encode(abi.ListenerRowMsg.decode(bytes)),
  ListenerTableMsg: (bytes) =>
    abi.ListenerTableMsg.encode(abi.ListenerTableMsg.decode(bytes)),
  RouteMsg: (bytes) => abi.RouteMsg.encode(abi.RouteMsg.decode(bytes)),
  SelectionChangeMsg: (bytes) =>
    abi.SelectionChangeMsg.encode(abi.SelectionChangeMsg.decode(bytes)),
  'EditorInputMsg.EditorCommand': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorSetState': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorSelection': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorPaste': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorInsertText': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorComposition': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorApplication': (bytes) => abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorKeyDown': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
  'EditorInputMsg.EditorText': (bytes) =>
    abi.EditorInputMsg.encode(abi.EditorInputMsg.decode(bytes)),
};
const value: unknown = JSON.parse(
  readFileSync(
    new URL('../../tests/abi/messages.json', import.meta.url),
    'utf8'
  )
);
if (!Array.isArray(value)) throw new Error('Invalid ABI fixture');
for (const row of value) {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('name' in row) ||
    typeof row.name !== 'string' ||
    !('bytes' in row) ||
    !Array.isArray(row.bytes) ||
    !row.bytes.every(
      (v: unknown) =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255
    )
  )
    throw new Error('Invalid ABI sample');
  const name = row.name,
    bytes = new Uint8Array(row.bytes);
  test(`Rust → Bebop → TS → Bebop → Rust byte equality: ${name}`, () => {
    const codec = codecs[name];
    if (!codec) throw new Error(`Missing ABI fixture codec ${name}`);
    expect(codec(bytes)).toEqual(bytes);
  });
}
