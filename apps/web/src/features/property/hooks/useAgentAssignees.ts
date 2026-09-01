import type { IUser } from '@core/user/types';
import { useAgentsQuery } from '@queries/agents/agents';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { type Accessor, createMemo } from 'solid-js';

function agentUser(bot: Bot): IUser {
  return {
    id: `bot|${bot.id}`,
    name: bot.name,
    // The handle stands in for the email: it fills the dropdown subtitle and
    // makes `@handle` searchable, and nothing consumes an assignee's email.
    email: bot.handle,
    photoUrl: bot.avatar_url ?? undefined,
  };
}

/**
 * Agents offerable as task assignees, as synthetic `IUser`s with canonical
 * `bot|<uuid>` ids — the same id shape bot mentions use. Assigning one to a
 * task opens an agent session prompted with the task (the backend's
 * task-assignment trigger), so only agents the caller can actually put to
 * work are listed.
 */
export function useAssignableAgentUsers(): Accessor<IUser[]> {
  const agents = useAgentsQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  return createMemo(() => {
    const cursorConnected = cursorStatus.data?.registered ?? false;
    return (agents.data ?? [])
      .filter(
        (agent) =>
          agent.bot.has_agent && (agent.harness !== 'cursor' || cursorConnected)
      )
      .map((agent) => agentUser(agent.bot));
  });
}
