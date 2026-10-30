import { externalChatsClient } from '@service-storage/external-chats';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';
import { invalidateExternalChat } from './index';

export function fetchExternalChatPermissions(chatId: string) {
  return externalChatsClient.permissions(chatId);
}
export async function updateExternalChatPermissions(
  chatId: string,
  request: UpdateSharePermissionRequestV2
) {
  const result = await externalChatsClient.updatePermissions(chatId, request);
  if (result.isOk()) invalidateExternalChat(chatId);
  return result;
}
