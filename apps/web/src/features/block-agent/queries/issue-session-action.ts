import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import type { AgentSession } from '@app/lib/queries/agent-session/agent-session';

/** Deliver a foreground session action and present any typed quota refusal. */
export async function issueSessionAction(
  session: Pick<AgentSession, 'issue'>,
  ...args: Parameters<AgentSession['issue']>
) {
  const result = await session.issue(...args);
  if (result.isErr()) handleAiUsageLimitError(result.error);
  return result;
}
