import { isMacroAgentId } from '@core/constant/macroAgent';
import type { UserItem } from '@core/context/quickAccess';
import type { MentionItem } from '../../../../utils/mentionsUtils';

export function isBotMentionId(id: string | undefined): boolean {
  return id?.startsWith('bot|') === true || isMacroAgentId(id);
}

export function isBotMentionUser(item: UserItem): boolean {
  return isBotMentionId(item.id);
}

export function isBotMentionItem(item: MentionItem): boolean {
  return item.kind === 'user' && isBotMentionUser(item);
}
