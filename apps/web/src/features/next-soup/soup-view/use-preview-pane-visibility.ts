import { isListViewID } from '@app/constants/list-views';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { createMemo } from 'solid-js';

export const WIDE_SPLIT_PANEL_BREAKPOINT = 640;

export function useIsNewInboxEnabled() {
  const panel = useSplitPanelOrThrow();

  const currentView = () => {
    const { type, id } = panel.handle.content();
    if (type !== 'component') return;
    return isListViewID(id) ? id : undefined;
  };

  const newInboxFlag = useFeatureFlag(ENABLE_NEW_INBOX_FLAG, {
    enabledOverride: ENABLE_NEW_INBOX_OVERRIDE,
  });

  const isNewInboxEnabled = () =>
    currentView() === 'inbox' && newInboxFlag().enabled;

  return isNewInboxEnabled;
}

export function usePreviewPaneVisiblity() {
  const panel = useSplitPanelOrThrow();
  const { soup, rows, previewOpen } = useSoupView();

  const isWideSplitPanel = createMemo(
    () => (panel.panelSize.width ?? 0) > WIDE_SPLIT_PANEL_BREAKPOINT
  );

  // Group headers and load-more rows carry a representative entity, but they
  // are navigation controls rather than user-selectable preview items.
  const selectedEntity = createMemo(() => {
    const row = soup.focus.row();
    if (!row || row.getIsGrouped() || row.getIsLoadMore()) return;
    return row.original;
  });

  const paneVisible = createMemo(
    () =>
      rows().length > 0 && !isMobile() && isWideSplitPanel() && previewOpen()
  );
  const previewVisible = createMemo(() => paneVisible() && !!selectedEntity());

  return {
    paneVisible,
    previewVisible,
    previewOpen,
    selectedEntity,
    isWideSplitPanel,
  };
}
