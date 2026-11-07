import { isBotPrincipalId } from '@core/constant/macroAgent';
import type { UserItem } from '@core/context/quickAccess';
import type { MentionItem } from '../../../../utils/mentionsUtils';

export function isBotMentionUser(item: UserItem): boolean {
  return isBotPrincipalId(item.id);
}

export function isBotMentionItem(item: MentionItem): boolean {
  if (item.kind === 'agent') return true;
  return item.kind === 'user' && isBotMentionUser(item);
}
