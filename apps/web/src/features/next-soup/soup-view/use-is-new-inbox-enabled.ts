import { isListViewID } from '@app/constants/list-views';
import { activeAppLayout } from '@app/features/app-layout/layout-state';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  ENABLE_NEW_INBOX_FLAG,
  ENABLE_NEW_INBOX_OVERRIDE,
} from '@core/constant/featureFlags';

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

  return () =>
    currentView() === 'inbox' &&
    (newInboxFlag().enabled ||
      (activeAppLayout().capabilities.usesNewInbox && !isTouchDevice()));
}
