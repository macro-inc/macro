import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID } from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';
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

  const { soup, rows } = useSoupView();

  const isNewInboxEnabled = useIsNewInboxEnabled();

  const isWideSplitPanel = createMemo(() => {
    return (panel.panelSize.width ?? 0) > WIDE_SPLIT_PANEL_BREAKPOINT;
  });

  const previewVisible = createMemo(
    () =>
      isWideSplitPanel() &&
      (!!soup.previewEntity() || panel.previewState[0]()) &&
      !!soup.focus.item()
  );

  // Placeholder display only for new inbox where the preview panel is open by default
  // Only open while no items are focused
  const previewPlaceholderVisible = createMemo(() => {
    return isWideSplitPanel() && isNewInboxEnabled() && !soup.focus.item();
  });

  const previewPaneVisible = createMemo(
    () => rows().length > 0 && (previewVisible() || previewPlaceholderVisible())
  );

  return {
    paneVisible: previewPaneVisible,
    placeholderVisible: previewPlaceholderVisible,
    previewVisible,
  };
}
