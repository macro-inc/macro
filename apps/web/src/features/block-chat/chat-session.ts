import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { ThrownResultError } from '@core/util/result';
import { fetchAndCacheChat } from '@queries/cognition/chat-data';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';

/** Reuses the query cache populated by the chat load, including on retry. */
export async function loadChatSession(chatId: string) {
  const response = await fetchAndCacheChat(chatId);
  if (response.isErr()) throw new ThrownResultError(response.error);
  return response.value;
}

export function canEditChat(access: AccessLevel, authenticated: boolean) {
  return (
    authenticated &&
    hasPermissions(getPermissions(access), Permissions.CAN_EDIT)
  );
}

export function usesLocalChatScope(
  nested: boolean | undefined,
  inSplit: boolean
) {
  return Boolean(nested) || !inSplit;
}
