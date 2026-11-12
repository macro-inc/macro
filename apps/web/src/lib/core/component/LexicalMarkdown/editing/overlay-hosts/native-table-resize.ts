import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import type { NativeTableKey } from '../../plugins/tables/nativeFacts';
import type { TableResizeHost } from './table-resize';

export type NativeTableResizeHit = {
  element: HTMLElement;
  key: NativeTableKey;
};

/** RED stub: the native backend for the shared TableCellResizer. */
export function createNativeTableResizeHost(
  _view: EditorView,
  _canEdit: Accessor<boolean>
): TableResizeHost<NativeTableResizeHit> & { dispose(): void } {
  const missing = (): never => {
    throw new Error('Native table resize host is not implemented');
  };
  return {
    cellFromTarget: missing,
    isEditable: missing,
    zoom: missing,
    beginDrag: missing,
    elementFor: missing,
    registerRoot: missing,
    registerLayout: missing,
    dispose() {},
  };
}
