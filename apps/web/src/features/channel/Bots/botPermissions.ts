import type { Bot } from '@service-storage/generated/schemas/bot';

type BotOwnership = Pick<Bot, 'created_by' | 'owner'> &
  Partial<Pick<Bot, 'has_agent'>>;

/** Whether the current user may delete an owned bot. */
export function canDeleteBot(
  bot: BotOwnership,
  currentUserId: string | undefined,
  currentTeamId: string | undefined,
  isCurrentTeamOwner: boolean,
  isCurrentTeamAdmin = false
): boolean {
  if (!currentUserId || !bot.owner) return false;
  if (bot.owner.type === 'user') {
    return bot.owner.user_id === currentUserId;
  }
  return (
    bot.owner.team_id === currentTeamId &&
    (bot.created_by === currentUserId ||
      isCurrentTeamOwner ||
      (bot.has_agent === true && isCurrentTeamAdmin))
  );
}

/** Whether Settings should treat this agent as one the caller can configure. */
export function canManageAgent(
  bot: BotOwnership,
  currentUserId: string | undefined,
  currentTeamId: string | undefined
): boolean {
  if (!currentUserId || !bot.owner) return false;
  if (bot.owner.type === 'user') return bot.owner.user_id === currentUserId;
  return bot.owner.team_id === currentTeamId;
}
