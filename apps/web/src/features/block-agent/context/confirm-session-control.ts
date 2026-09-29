import type { AgentSession } from '@core/agent-session/AgentSession';
import type { AgentAction } from '@service-agent-harness/generated/schemas';

/** HTTP acceptance only queues a control. Wait for its correlated ACP outcome. */
export async function confirmSessionControl(
  session: Pick<AgentSession, 'issue' | 'snapshot' | 'subscribe'>,
  action: AgentAction
): Promise<void> {
  const result = await session.issue(action);
  if (result.isErr())
    throw new Error(result.error.map((error) => error.message).join(' '));
  const actionId = result.value.actionId;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
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
    const timeout = setTimeout(
      () =>
        finish(new Error('The agent did not confirm the selected setting.')),
      60_000
    );
    const unsubscribe = session.subscribe(() => void inspect());
    void inspect();
  });
}
