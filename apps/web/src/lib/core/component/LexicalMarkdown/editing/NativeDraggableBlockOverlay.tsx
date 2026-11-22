import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { type Accessor, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { HostedDraggableBlockMenu } from '../component/misc/HostedDraggableBlockMenu';
import type { NativeDragState } from '../plugins/draggable-block/native';
import { createNativeDraggableBlockHost } from './overlay-hosts/native-draggable-block';

export function NativeDraggableBlockOverlay(props: {
  view: EditorView;
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
  own(cleanup: () => void): void;
}) {
  const [state, setState] = createStore<NativeDragState>({
    hoveredElement: null,
    isDragging: false,
    targetElement: null,
    targetPosition: null,
  });
  const host = createNativeDraggableBlockHost(
    props.view,
    () => props.alive() && props.canEdit(),
    (next) => setState(next)
  );
  onCleanup(host.dispose);
  props.own(host.dispose);
  return (
    <HostedDraggableBlockMenu
      state={state}
      host={host}
      active={props.alive() && props.canEdit()}
    />
  );
}
