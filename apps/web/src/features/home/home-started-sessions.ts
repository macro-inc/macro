import type { PendingSession } from '@app/features/block-agent/context/pending-session';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import type { AgentSessionEntity, EntityData } from '@entity';
import { type Accessor, createEffect, createSignal } from 'solid-js';

type StartedSession = {
  /** The id Home opened the session under. */
  id: string;
  pending: Pick<PendingSession, 'sessionId' | 'failed'>;
  entity: AgentSessionEntity;
};

export type HomeStartedSessions = ReturnType<typeof createHomeStartedSessions>;

/**
 * Sessions started from Home's composer, shown in Home's list at once. The
 * list learns of a session only after its create answers and the work feed
 * records the viewer's work on it, which a cold sandbox stretches to minutes.
 */
export function createHomeStartedSessions() {
  const [started, setStarted] = createSignal<readonly StartedSession[]>([]);
  const [opened, setOpened] = createSignal<string>();

  /** The create's id once it answers; an expired warm claim mints another. */
  const resolvedId = (session: StartedSession) =>
    session.pending.sessionId() ?? session.id;

  const record = (input: {
    id: string;
    pending: Pick<PendingSession, 'sessionId' | 'failed'>;
    prompt: string;
    botId?: string;
    repoUrl?: string;
    userId: string;
    startedAt: string;
  }) => {
    const entity: AgentSessionEntity = {
      type: 'agent_session',
      id: input.id,
      name: deriveChatName(input.prompt) ?? '',
      ownerId: input.userId,
      botId: input.botId ?? '',
      repoUrl: input.repoUrl,
      status: 'booting',
      source: 'user',
      visibility: 'listed',
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
      sortTs: input.startedAt,
    };
    setStarted((current) => [
      { id: input.id, pending: input.pending, entity },
      ...current,
    ]);
    setOpened(input.id);
  };

  /**
   * Rows for the started sessions `listed` does not hold yet, newest first.
   * A session leaves once its own row is listed or its create fails, so a
   * later change to the list can't bring it back.
   */
  const unlisted = (
    listed: Accessor<readonly EntityData[]>
  ): Accessor<AgentSessionEntity[]> => {
    const listedIds = () => new Set(listed().map((entity) => entity.id));

    createEffect(() => {
      const ids = listedIds();
      const settled = started().filter(
        (session) => session.pending.failed() || ids.has(resolvedId(session))
      );
      if (settled.length === 0) return;

      setStarted((current) =>
        current.filter((session) => !settled.includes(session))
      );
    });

    return () => {
      const ids = listedIds();
      return started()
        .filter(
          (session) =>
            !session.pending.failed() && !ids.has(resolvedId(session))
        )
        .map((session) => ({ ...session.entity, id: resolvedId(session) }));
    };
  };

  return {
    record,
    unlisted,
    /** The session the composer just opened, until the list highlights it. */
    opened,
    clearOpened: () => setOpened(undefined),
  };
}
