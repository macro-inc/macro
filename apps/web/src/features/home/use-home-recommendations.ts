import { LIST_VIEW_PATHS } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useChatInputContext } from '@core/component/AI/context';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useSettingsState } from '@core/constant/SettingsState';
import type { Entity } from '@core/types';
import {
  compositeEntity,
  fetchNotificationsForEntities,
  openNotification,
} from '@notifications';
import { createHomeRecommendations } from '@queries/ai/createHomeRecommendations';
import {
  deriveRecommendedView,
  type RecommendedItem,
} from '@queries/ai/homeRecommendations';
import { useEmailLinksQuery } from '@queries/email/link';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import { useNavigate } from '@solidjs/router';
import { match } from 'ts-pattern';
import { replaceHomeComposerSelection } from './home-composer-selection';

const ATTACHABLE_ENTITY_TYPES = new Set<RecommendedItem['entityType']>([
  'channel',
  'document',
  'email_thread',
  'project',
]);

/** Shared Home recommendation data and open/draft actions. */
export function useHomeRecommendations() {
  const input = useChatInputContext();
  const notificationSource = useGlobalNotificationSource();
  const { openSettings } = useSettingsState();
  const navigate = useNavigate();

  const emailLinks = useEmailLinksQuery();
  const recommendations = createHomeRecommendations();

  const view = () =>
    deriveRecommendedView({
      loading: emailLinks.isLoading || recommendations.isLoading(),
      failed:
        (emailLinks.isError && emailLinks.data === undefined) ||
        recommendations.hasError(),
      items: recommendations.items(),
      emailLinked:
        emailLinks.isSuccess && (emailLinks.data?.links.length ?? 0) > 0,
    });
  const items = () => {
    const current = view();
    return current.kind === 'items' ? current.items : [];
  };

  const selectRecommendation = (item: RecommendedItem) => {
    replaceHomeComposerSelection(
      input,
      item.prompt,
      ATTACHABLE_ENTITY_TYPES.has(item.entityType)
        ? [{ entity_id: item.entityId, entity_type: item.entityType }]
        : undefined
    );
  };

  const openRecommendation = async (item: RecommendedItem) => {
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    const entity = { id: item.entityId, type: item.entityType } as Entity;
    let notification =
      notificationSource.notificationsByEntity()[compositeEntity(entity)]?.[0];
    if (!notification) {
      notification = (await fetchNotificationsForEntities([entity]))[0];
    }

    if (notification) {
      const result = await openNotification(notification, splitManager, true);
      if (result.isOk()) {
        await notificationSource.markAsRead(notification);
        return;
      }
    }

    return match(item.entityType)
      .with('email_thread', () =>
        splitManager.openWithSplit(
          { type: 'email', id: item.entityId },
          { activate: true, preferNewSplit: true }
        )
      )
      .with('channel', 'chat', 'call', 'project', (entityType) =>
        splitManager.openWithSplit(
          { type: entityType, id: item.entityId },
          { activate: true, preferNewSplit: true }
        )
      )
      .with('document', async () => {
        const metadata = await fetchDocumentMetadata(item.entityId);
        return splitManager.openWithSplit(
          {
            type: fileTypeToBlockName(metadata.subType ?? metadata.fileType),
            id: item.entityId,
          },
          { activate: true, preferNewSplit: true }
        );
      })
      .otherwise(() => navigate(LIST_VIEW_PATHS.inbox));
  };

  const retry = () => {
    void Promise.allSettled([emailLinks.refetch(), recommendations.retry()]);
  };

  return {
    view,
    items,
    selectRecommendation,
    openRecommendation,
    retry,
    openSettings,
    navigate,
  };
}
