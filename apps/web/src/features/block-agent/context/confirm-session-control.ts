import type { AgentSession } from '@core/agent-session/AgentSession';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { issueSessionAction } from '../queries/issue-session-action';

/** Unanswered this long, the log is read directly in case the live feed missed it. */
const REFRESH_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 60_000;
/** A final reread still out after this is abandoned so giving up cannot hang. */
const FINAL_REREAD_MAX_MS = 10_000;

/**
 * HTTP acceptance only queues a control. Wait for its correlated ACP outcome.
 *
 * The outcome reaches the fold through the live log feed, which can miss
 * rows while a sandbox wakes. Unanswered, the log is refetched once early and
 * again before giving up. A control the log still has not settled is
 * retracted when this gives up, so the selector shows the runtime's own model
 * and accepts another choice rather than holding the change in flight.
 */
export function confirmSessionControl(
  session: Pick<
    AgentSession,
    'id' | 'issue' | 'snapshot' | 'subscribe' | 'refresh' | 'retract'
  >,
  action: AgentAction
): Promise<void> {
  return Telemetry.span('agent.session.confirm_control', async (span) => {
    span.setAttr('agent.session.id', session.id);
    span.setAttr('agent.control.type', action.type);
    try {
      await awaitConfirmation(session, action, span);
    } catch (error) {
      span.error(error);
      throw error;
    }
  });
}

async function awaitConfirmation(
  session: Pick<
    AgentSession,
    'issue' | 'snapshot' | 'subscribe' | 'refresh' | 'retract'
  >,
  action: AgentAction,
  span: Span
): Promise<void> {
  const result = await issueSessionAction(session, action);
  if (result.isErr()) {
    span.setAttr('agent.control.outcome', 'refused');
    throw new Error(result.error.map((error) => error.message).join(' '));
  }
  const actionId = result.value.actionId;
  span.setAttr('agent.action.id', actionId);
  let refreshes = 0;
  let settledBy: 'feed' | 'refresh' = 'feed';
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      span.setAttr('agent.control.refreshes', refreshes);
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
        span.setAttr('agent.control.outcome', part.outcome.kind);
        span.setAttr('agent.control.settled_by', settledBy);
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
      refreshes += 1;
      await session.refresh();
      settledBy = 'refresh';
      await inspect();
      settledBy = 'feed';
    };
    const giveUp = async () => {
      let bound: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reread(),
          new Promise<void>((resolve) => {
            bound = setTimeout(resolve, FINAL_REREAD_MAX_MS);
          }),
        ]);
      } finally {
        clearTimeout(bound);
        if (!finished) {
          session.retract(actionId);
          span.setAttr('agent.control.outcome', 'retracted');
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
