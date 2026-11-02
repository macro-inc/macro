import type { AgentSession } from '@core/agent-session/AgentSession';
import { fireAndForget } from '@core/util/fireAndForget';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { issueSessionAction } from '../queries/issue-session-action';

/** Unanswered this long, the log is read directly in case the live feed missed it. */
const REFRESH_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 60_000;

/**
 * HTTP acceptance only queues a control. Wait for its correlated ACP outcome.
 *
 * The outcome reaches the fold through the live log feed, which can miss
 * rows while a sandbox wakes. Unanswered, the log is refetched once early and
 * again before giving up. A control the log still has not settled is
 * retracted when this gives up, so the selector shows the runtime's own model
 * and accepts another choice rather than holding the change in flight.
 */
export async function confirmSessionControl(
  session: Pick<
    AgentSession,
    'issue' | 'snapshot' | 'subscribe' | 'refresh' | 'retract'
  >,
  action: AgentAction
): Promise<void> {
  const result = await issueSessionAction(session, action);
  if (result.isErr())
    throw new Error(result.error.map((error) => error.message).join(' '));
  const actionId = result.value.actionId;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(refresh);
      clearTimeout(timeout);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = async () => {
      try {
        const snapshot = await session.snapshot();
        const message = snapshot.messages.find(
          (message) => message.requestId === actionId
        );
        if (!message || message.pending) return;
        const part = message.parts.find((part) => part.kind === 'control');
        if (part?.kind !== 'control' || part.outcome.kind === 'pending') return;
        finish(
          part.outcome.kind === 'rejected'
            ? new Error(part.outcome.message)
            : undefined
        );
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Could not confirm the session setting.')
        );
      }
    };
    const reread = async () => {
      await session.refresh();
      await inspect();
    };
    const giveUp = async () => {
      try {
        await reread();
      } finally {
        if (!finished) {
          session.retract(actionId);
          finish(new Error('The agent did not confirm the selected setting.'));
        }
      }
    };
    const refresh = setTimeout(
      () => fireAndForget(reread(), 'agent-session'),
      REFRESH_AFTER_MS
    );
    const timeout = setTimeout(
      () => fireAndForget(giveUp(), 'agent-session'),
      GIVE_UP_AFTER_MS
    );
    const unsubscribe = session.subscribe(() =>
      fireAndForget(inspect(), 'agent-session')
    );
    fireAndForget(inspect(), 'agent-session');
  });
}
