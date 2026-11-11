import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { type Accessor, onCleanup, Show } from 'solid-js';
import { HostedTableDeleteButtons } from '../component/misc/TableDeleteButtons';
import { HostedTableInsertButton } from '../component/misc/TableInsertButton';
import { createNativeTableHoverHost } from './overlay-hosts/native-table-hover';

/** The existing border controls use actual native table facts and actions. */
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
  return (
    <Show when={props.alive() && props.canEdit() && !isTouchDevice()}>
      <HostedTableInsertButton host={resource.insertHost} />
      <HostedTableDeleteButtons host={resource.deleteHost} />
    </Show>
  );
}
