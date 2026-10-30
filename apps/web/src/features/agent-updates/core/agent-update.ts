import type { AgentSessionEntity } from '@entity';
import type {
  FoldedMessage,
  PendingInteraction,
} from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';
import {
  isCoderHarness,
  systemBotKind,
} from '../../agents-view/core/agent-kind';

export type AgentUpdate = {
  id: string;
  sessionId: string;
  sessionName: string;
  updatedAt: number;
  summary: string;
} & (
  | { kind: 'stalled' }
  | { kind: 'interaction'; request: PendingInteraction }
);

export type UpdateSession = Pick<
  AgentSessionEntity,
  | 'id'
  | 'name'
  | 'ownerId'
  | 'isArchived'
  | 'harness'
  | 'botId'
  | 'turnState'
  | 'updatedAt'
>;

export function eligibleSessions(
  sessions: readonly UpdateSession[],
  ownerId: string | undefined
): UpdateSession[] {
  if (!ownerId) return [];
  return sessions.filter(
    (session) =>
      session.ownerId === ownerId &&
      !session.isArchived &&
      (isCoderHarness(session.harness) ||
        (!session.harness && systemBotKind(session.botId) === 'coder'))
  );
}

export function blockedSessions(
  sessions: readonly UpdateSession[]
): UpdateSession[] {
  return sessions.filter((session) => session.turnState === 'blocked');
}

function timestamp(session: UpdateSession): number {
  const value = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function summary(
  request: PendingInteraction,
  messages: readonly FoldedMessage[]
): string {
  return match(request)
    .with({ kind: 'permission' }, (permission) => {
      const tool = messages
        .find(
          (message) =>
            message.author.kind === 'agent' && message.turn === permission.turn
        )
        ?.parts.find(
          (part) => part.kind === 'tool_use' && part.id === permission.toolCall
        );
      if (tool?.kind !== 'tool_use')
        return 'Wants permission to run a tool';
      const label =
        tool.detail.kind === 'terminal'
          ? (tool.detail.command ?? 'a command')
          : tool.name.kind === 'mcp'
            ? tool.name.tool
            : tool.name.name;
      return `Wants to run ${label.replace(/\s+/g, ' ')}`;
    })
    .with({ kind: 'elicitation' }, () => 'Has a question')
    .with(
      { kind: 'tool_approval' },
      (approval) =>
        `Wants to use ${approval.toolName} from ${approval.serverName}`
    )
    .exhaustive();
}

export function selectAgentUpdates(
  sessions: readonly UpdateSession[],
  pendingBySession: ReadonlyMap<string, readonly PendingInteraction[]>,
  messagesBySession: ReadonlyMap<string, readonly FoldedMessage[]>,
  now = Date.now()
): AgentUpdate[] {
  return sessions
    .flatMap((session): AgentUpdate[] => {
      const updatedAt = timestamp(session);
      const sessionName = session.name || 'Untitled conversation';
      if (
        session.turnState === 'running' &&
        updatedAt > 0 &&
        now - updatedAt > 20 * 60_000
      ) {
        return [
          {
            kind: 'stalled',
            id: `${session.id}:stalled`,
            sessionId: session.id,
            sessionName,
            updatedAt,
            summary: `No activity for ${Math.floor((now - updatedAt) / 60_000)} minutes`,
          },
        ];
      }
      if (session.turnState !== 'blocked') return [];
      return (pendingBySession.get(session.id) ?? []).toReversed().map(
        (request): AgentUpdate => ({
          kind: 'interaction',
          id: `${session.id}:${request.turn}:${request.kind}:${request.kind === 'tool_approval' ? request.approvalId : request.requestId}`,
          sessionId: session.id,
          sessionName,
          updatedAt,
          summary: summary(
            request,
            messagesBySession.get(session.id) ?? []
          ),
          request,
        })
      );
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}
