import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { NotificationData } from './notification-preview';

export type NavigationActions = {
  insertSplit: (item: { type: BlockName; id: string }) => void;
  replaceSplit: (item: { type: BlockName; id: string }) => void;
  messageLocation: (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => Promise<void>;
};

export function navigateToNotification({
  data,
  actions,
  shouldInsert = false,
}: {
  data: NotificationData;
  actions: NavigationActions;
  shouldInsert?: boolean;
}): void {
  const { messageLocation } = actions;

  const replaceOrInsertSplit = shouldInsert
    ? actions.insertSplit
    : actions.replaceSplit;

  console.log(replaceOrInsertSplit);

  if (!data.target?.id) return;

  const targetType = data.target.type;
  const targetId = data.target.id;

  switch (targetType) {
    case 'channel':
      if (data.meta?.messageId) {
        replaceOrInsertSplit({ type: 'channel', id: targetId });
        messageLocation(targetId, data.meta.messageId, data.meta.threadId);
      } else {
        replaceOrInsertSplit({ type: 'channel', id: targetId });
      }
      break;

    case 'document':
      if (data.meta?.fileType) {
        const blockType = fileTypeToBlockName(data.meta.fileType) as BlockName;
        replaceOrInsertSplit({ type: blockType, id: targetId });
      }
      break;

    case 'email':
      replaceOrInsertSplit({ type: 'email', id: targetId });
      break;

    case 'team':
      // Team notifications don't have a corresponding block to navigate to
      break;

    default:
      if (data.meta?.itemType) {
        const blockType = data.meta.itemType.toLowerCase() as BlockName;
        replaceOrInsertSplit({ type: blockType, id: targetId });
      }
      break;
  }
}
