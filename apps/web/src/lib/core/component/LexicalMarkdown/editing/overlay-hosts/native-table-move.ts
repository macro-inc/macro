import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import type { NativeTableKey } from '../../plugins/tables/nativeFacts';
import type { TableMoveHost } from './table-move';

/** RED stub: the native backend for the shared TableMoveHandle. */
export function createNativeTableMoveHost(
  _view: EditorView,
  _canEdit: Accessor<boolean>
): TableMoveHost<NativeTableKey> & { dispose(): void } {
  const missing = (): never => {
    throw new Error('Native table move host is not implemented');
  };
  return {
    trackedCells: missing,
    registerSelection: missing,
    registerFocus: missing,
    registerLayout: missing,
    elementFor: missing,
    shape: missing,
    previewRect: missing,
    move: missing,
    selectCells: missing,
    menuAction: missing,
    dispose() {},
  };
}
