import { useAgentMentionUsers } from '@channel/use-agent-mention-users';
import { botMentionUsers } from '@channel/use-channel-bot-mention-users';
import { useQuickAccess } from '@core/context/quickAccess';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import { createMentionableBots } from '@queries/bots/graphql-bots';
import type { Accessor } from 'solid-js';

/**
 * Workspace people and agents for a routine prompt's `@` menu. A prompt mention
 * only names its agent: nothing here dispatches on it. An agent whose runtime is
 * away stays pickable, because the routine can name it before it next runs.
 */
export function useRoutinePromptMentionUsers(): Accessor<IUser[]> {
  const people = useQuickAccess().useList('person').items;
  const savedAgents = createMentionableBots(() => null);
  const canUseCursor = useCursorAgentsAccess();
  const agents = useAgentMentionUsers(() =>
    botMentionUsers(savedAgents.bots(), canUseCursor())
  );

  return () =>
    uniqueByKey(
      [...people().map((person) => person.data), ...agents()],
      (user) => user.id
    );
}
