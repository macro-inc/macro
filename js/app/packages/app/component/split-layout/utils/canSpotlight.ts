import { isSettingsPanelOpen } from '@core/signal/layout';
import type { SplitManager } from '../layoutManager';

export function canSpotlight(splitManager: SplitManager) {
  return splitManager.splits().length > 1 || isSettingsPanelOpen();
}
