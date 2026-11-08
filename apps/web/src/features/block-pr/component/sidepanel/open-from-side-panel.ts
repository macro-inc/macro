import { useSidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { OpenPrLink } from '../PrLinks';

/**
 * Opens a linked item from the pull request's side panel. On touch the panel
 * is a sheet over the pane, so it closes first; otherwise it would cover what
 * just opened.
 */
export function useOpenFromSidePanel(): OpenPrLink {
  const layout = useSplitLayout();
  const sidePanel = useSidePanel();
  return (content: SplitContent, newSplit: boolean) => {
    if (isTouchDevice()) sidePanel?.setIsOpen(false);
    layout?.openWithSplit(content, { preferNewSplit: newSplit });
  };
}
