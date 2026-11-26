import { getDisplayNameParts, tryMacroId } from '@core/user';
import type { Harness } from '@service-storage/client';

/**
 * The agent teammate a computer belongs to, by name: its account's name once
 * loaded, else the harness's own name, else empty. (A display name falls back
 * to the account's email while it loads, which never names an agent here.)
 */
export function agentScreenName(
  harness: Pick<Harness, 'team_agent_user_id' | 'name'> | undefined
): string {
  const agentUserId = harness?.team_agent_user_id;
  const parts = agentUserId
    ? getDisplayNameParts(tryMacroId(agentUserId))
    : undefined;
  const name = [parts?.firstName, parts?.lastName].filter(Boolean).join(' ');
  return name || harness?.name || '';
}
