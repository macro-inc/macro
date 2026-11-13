import type { ClaudeModeResponse } from '@service-agent-harness/generated/schemas';
import type { Harness } from '@service-storage/client';
import { match } from 'ts-pattern';

/** How an agent teammate's Claude Code is paid for, as its row shows it. */
export type AgentClaudeState = 'loading' | 'credits' | 'signed_in' | 'expired';

/**
 * The runtime on an agent teammate's computer. macrod creates it when the
 * computer first connects, so there is none before then.
 */
export function agentComputerHarness(
  computerId: string | null,
  harnesses: readonly Harness[] | undefined
): Harness | undefined {
  if (!computerId) return undefined;
  return harnesses?.find((harness) => harness.computer_id === computerId);
}

/**
 * The computer's own Claude sign-in stops working at its expiry; Claude's
 * credential names no account, so that is all there is to show.
 */
export function agentClaudeState(
  mode: ClaudeModeResponse | undefined,
  now: number
): AgentClaudeState {
  if (!mode) return 'loading';

  return match(mode.mode)
    .returnType<AgentClaudeState>()
    .with('macro_credits', () => 'credits')
    .with('own_account', () => {
      const expiresAt = mode.account?.expiresAt;
      const expired = !!expiresAt && Date.parse(expiresAt) <= now;
      return expired ? 'expired' : 'signed_in';
    })
    .exhaustive();
}
