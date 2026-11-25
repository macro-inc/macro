import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';
import { DriveRedesignMobileWorkspace } from './views/mobile/drive-redesign-mobile';
import { DriveRedesignWorkspace } from './views/redesign/drive-redesign-workspace';

/**
 * Single device composition entry for the redesigned Drive workspace (FE-70).
 * Desktop renders the multi-view desktop workspace; touch renders the
 * dedicated touch-first workspace.
 */
export function DriveRedesignEntry(props: { tour?: JSX.Element }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<DriveRedesignWorkspace tour={props.tour} />}
    >
      <DriveRedesignMobileWorkspace tour={props.tour} />
    </Show>
  );
}
