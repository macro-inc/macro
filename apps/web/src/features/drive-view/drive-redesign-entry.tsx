import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';
import { DriveWorkspace } from './views/drive-workspace';
import { DriveRedesignWorkspace } from './views/redesign/drive-redesign-workspace';

/**
 * Single device composition entry for the redesigned Drive workspace (FE-70).
 * Desktop renders the full redesigned workspace; touch delegates to the
 * dedicated mobile composition (upgraded in the mobile PR).
 */
export function DriveRedesignEntry(props: { tour?: JSX.Element }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<DriveRedesignWorkspace tour={props.tour} />}
    >
      <DriveWorkspace tour={props.tour} />
    </Show>
  );
}
