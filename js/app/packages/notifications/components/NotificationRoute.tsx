import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { openNotificationFromId } from '@notifications/notification-navigation';
import { logger } from '@observability';
import { useSearchParams } from '@solidjs/router';
import { createEffect, onCleanup, onMount } from 'solid-js';

export default function NotificationRoute() {
  const split = useSplitPanelOrThrow();
  const [searchParams] = useSearchParams();

  const getNotificationId = (): string | undefined => {
    const raw = searchParams.notificationId;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
    return undefined;
  };

  const replaceWithUnifiedList = (cause?: Error) => {
    logger.error('Failed to open notification.', { cause });
    toast.failure('Failed to open notification.');
    split.handle.replace({
      next: { type: 'component', id: 'unified-list' },
      mergeHistory: true,
    });
  };

  // Give the router a tick to populate params before falling back to unified-list
  onMount(() => {
    const timeout = window.setTimeout(() => {
      const notificationId = getNotificationId();
      if (!notificationId) {
        replaceWithUnifiedList(new Error('No notification ID found.'));
      }
    }, 0);
    onCleanup(() => window.clearTimeout(timeout));
  });

  const notificationSource = useGlobalNotificationSource();

  createEffect(() => {
    const notificationId = getNotificationId();
    const layoutManager = globalSplitManager();
    if (!notificationId) return;
    if (!layoutManager) return;

    openNotificationFromId(
      notificationId,
      layoutManager,
      notificationSource
    ).match(
      () => {
        // We only use this route as a "bridge" from external navigation into the split layout.
        // At narrowWidths, openWithSplit replaces this split in-place, so content()
        // will have changed by the time we get here — closing would navigate
        // away from the notification. Only close if we're still the bridge.
        const current = split.handle.content();
        if (current.type === 'component' && current.id === 'notification') {
          split.handle.close();
        }
      },
      (err) => {
        replaceWithUnifiedList(new Error(err.tag));
      }
    );
  });

  return <LoadingBlock />;
}
