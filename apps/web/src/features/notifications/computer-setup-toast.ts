import {
  type ComputerSetupNotice,
  showComputerSetupNotice,
} from '@app/features/settings/computers/primitives/setup-notice';
import { requestComputerSetup } from '@app/features/settings/computers/primitives/setup-request';
import { globalSplitManager } from '@app/signal/splitLayout';
import { openRuntimesSettings } from './notification-navigation';

/**
 * Back into the computer's guided setup on Bring your AI, from wherever the
 * app is: Settings → Machines opens and reopens the setup dialog there.
 */
export function openComputerSetup(computerId: string) {
  requestComputerSetup(computerId);
  const layout = globalSplitManager();
  if (layout) openRuntimesSettings(layout, {});
}

/** A computer setup notification that arrived while the app is open. */
export function showComputerSetupToast(notice: ComputerSetupNotice) {
  showComputerSetupNotice(notice, () => openComputerSetup(notice.computerId));
}
