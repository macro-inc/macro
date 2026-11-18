import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../group-b/command';

export function convertNativeListToTable(view: EditorView, key: number) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: 'convert-list',
    key,
  });
}
export function insertNativeTable(
  view: EditorView,
  rows: number,
  columns: number,
  headers: boolean | { rows: boolean; columns: boolean } = true
) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: 'insert',
    rows,
    columns,
    headers,
  });
}
export function deleteNativeTableAtHover(
  view: EditorView,
  cell: number,
  axis: 'row' | 'column' | 'table'
) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: 'delete',
    cell,
    axis,
  });
}
export function insertNativeTableAxis(
  view: EditorView,
  cell: number,
  axis: 'row' | 'column',
  after: boolean
) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: axis === 'row' ? 'insert-row' : 'insert-column',
    cell,
    after,
  });
}
export function moveNativeTableCells(
  view: EditorView,
  anchor: number,
  focus: number,
  target: number
) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: 'move-cells',
    anchor,
    focus,
    target,
  });
}
export function registerNativeTablePicker(
  view: EditorView,
  onOpen: () => void
): () => void {
  return view.onPluginEvent('group-b.table-picker', () => {
    if (view.isMounted && view.root.contentEditable === 'true') onOpen();
  });
}
export function tryNativeTablePicker(view: EditorView) {
  return dispatchApplicationCommand(view, 'group-b.table', {
    action: 'picker',
  });
}
export function convertibleNativeLists(view: EditorView): readonly number[] {
  const value = queryApplication(view, 'group-b.table-convertible', {});
  if (
    !Array.isArray(value) ||
    !value.every(
      (key: unknown) => typeof key === 'number' && Number.isInteger(key)
    )
  )
    throw new Error('Invalid convertible-list query');
  return value;
}
