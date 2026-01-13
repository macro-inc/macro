import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { openNotificationFromId } from '@notifications/notification-navigation';
import { logger } from '@observability';
import { useSearchParams } from '@solidjs/router';
import { createEffect } from 'solid-js';

export default function NotificationRoute() {
  const split = useSplitPanelOrThrow();
  const [searchParams] = useSearchParams();

  const replaceWithUnifiedList = (reason?: unknown) => {
    if (reason) {
      logger.error(
        `Falling back from NotificationRoute to unified-list: ${reason}`,
        { cause: new Error() }
      );
    }
    toast.failure('Failed to open notification.');
    split.handle.replace({
      next: { type: 'component', id: 'unified-list' },
      mergeHistory: true,
    });
  };

  createEffect(() => {
    const notificationId = searchParams.notificationId;
    const layoutManager = globalSplitManager();
    if (!notificationId || typeof notificationId !== 'string') {
      replaceWithUnifiedList({ tag: 'MissingNotificationId', notificationId });
      return;
    }
    if (!layoutManager) {
      replaceWithUnifiedList({ tag: 'MissingSplitManager' });
      return;
    }

    openNotificationFromId(notificationId, layoutManager).match(
      () => {
        // We only use this route as a "bridge" from external navigation
        // (e.g. push tap / deep link) into the split layout.
        split.handle.close();
      },
      (err) => {
        replaceWithUnifiedList(err);
      }
    );
  });

  return <LoadingBlock />;
}
