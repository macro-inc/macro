import { useAgentMentionUsers } from '@channel/use-agent-mention-users';
import { availableBotMentionUsers } from '@channel/use-channel-bot-mention-users';
import { useQuickAccess } from '@core/context/quickAccess';
import { useCursorAgentsAccess } from '@core/cursor/flag';
import type { IUser } from '@core/user/types';
import { uniqueByKey } from '@core/util/compareUtils';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import type { Accessor } from 'solid-js';

/**
 * Workspace people and agents for a routine prompt's `@` menu. A prompt mention
 * only names its agent: nothing here dispatches on it. An agent whose runtime is
 * away stays pickable, because the routine can name it before it next runs.
 */
export function useRoutinePromptMentionUsers(): Accessor<IUser[]> {
  const people = useQuickAccess().useList('person').items;
  const savedAgents = useAgentsQuery();
  const canUseCursor = useCursorAgentsAccess();
  const agents = useAgentMentionUsers(() =>
    availableBotMentionUsers(
      [],
      queryReadyGate(savedAgents) ? savedAgents.data : [],
      canUseCursor(),
      'document'
    )
  );

  return () =>
    uniqueByKey(
      [...people().map((person) => person.data), ...agents()],
      (user) => user.id
    );
}
