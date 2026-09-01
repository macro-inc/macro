import type { Bot } from '@service-storage/generated/schemas/bot';

type BotOwnership = Pick<Bot, 'created_by' | 'owner'>;

/** Whether the current user may delete an owned bot. */
export function canDeleteBot(
  bot: BotOwnership,
  currentUserId: string | undefined,
  currentTeamId: string | undefined,
  isCurrentTeamOwner: boolean
): boolean {
  if (!currentUserId || !bot.owner) return false;
  if (bot.owner.type === 'user') {
    return bot.owner.user_id === currentUserId;
  }
  return (
    bot.created_by === currentUserId ||
    (bot.owner.team_id === currentTeamId && isCurrentTeamOwner)
  );
}
