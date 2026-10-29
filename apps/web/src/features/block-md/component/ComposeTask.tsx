import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import type { ComposeTaskProps } from '../../task-composer/core/types';
import { DesktopTaskComposer } from '../../task-composer/views/desktop-task-composer';
import { MobileTaskComposer } from '../../task-composer/views/mobile-task-composer';

/** Touch devices show a popover split in a bottom sheet, with its own layout. */
export function ComposeTask(props: ComposeTaskProps) {
  const splitPanel = useSplitPanelOrThrow();
  return (
    <Show
      when={isTouchDevice() && splitPanel.handle.isPopover()}
      fallback={<DesktopTaskComposer {...props} />}
    >
      <MobileTaskComposer {...props} />
    </Show>
  );
}
