import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { type Accessor, onCleanup, Show } from 'solid-js';
import { TableCellResizerView } from '../component/misc/TableCellResizerView';
import { HostedTableDeleteButtons } from '../component/misc/TableDeleteButtons';
import { HostedTableInsertButton } from '../component/misc/TableInsertButton';
import { TableMoveHandleView } from '../component/misc/TableMoveHandleView';
import { TableSelectionActionBarView } from '../component/misc/TableSelectionActionBarView';
import { createNativeTableHoverHost } from './overlay-hosts/native-table-hover';
import { createNativeTableMoveHost } from './overlay-hosts/native-table-move';
import { createNativeTableResizeHost } from './overlay-hosts/native-table-resize';
import { createNativeTableSelectionActionsHost } from './overlay-hosts/native-table-selection-actions';

/**
 * Source's editable table controls over actual native table facts and
 * actions: border insert/delete (pointer), the selection action bar (touch),
 * the cell resizer and the move handle.
 */
export function NativeTableHoverOverlay(props: {
  view: EditorView;
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
  own(cleanup: () => void): void;
  onUnavailable(error: unknown): void;
}) {
  const resource = createNativeTableHoverHost(
    props.view,
    () => props.alive() && props.canEdit(),
    props.onUnavailable
  );
  onCleanup(resource.dispose);
  props.own(resource.dispose);
  const editable = () => props.alive() && props.canEdit();
  const move = createNativeTableMoveHost(props.view, editable);
  onCleanup(move.dispose);
  props.own(move.dispose);
  const resize = createNativeTableResizeHost(props.view, editable);
  onCleanup(resize.dispose);
  props.own(resize.dispose);
  const actions = createNativeTableSelectionActionsHost(props.view, editable);
  return (
    <Show when={editable()}>
      {/* On touch devices the hover-driven controls are unusable */}
      <Show
        when={isTouchDevice()}
        fallback={
          <>
            <HostedTableInsertButton host={resource.insertHost} />
            <HostedTableDeleteButtons host={resource.deleteHost} />
          </>
        }
      >
        <TableSelectionActionBarView host={actions} />
      </Show>
      <TableCellResizerView host={resize} />
      <TableMoveHandleView host={move} />
    </Show>
  );
}
