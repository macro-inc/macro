import type { PresentView } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { AgentSession } from './agent-session';
import type { CodeExecution } from './code-execution';

/** A dynamic-UI view: the object the `PresentView` tool takes as `view`. */
export type SessionView = PresentView['view'];

/**
 * Present a view in a session: a review with nothing saved. The view is
 * checked and drawn at once; one that does not match throws with what to fix.
 */
export async function presentView(
  client: MacroClient,
  session: AgentSession,
  view: SessionView,
  execution?: CodeExecution,
): Promise<void> {
  unwrap(
    await client.agentHarness.presentSessionView({
      path: { session_id: session.id },
      body: { view, executionId: execution?.id ?? null },
    }),
  );
}
