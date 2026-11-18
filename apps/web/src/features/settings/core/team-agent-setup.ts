import type { ComputerStatus } from '@service-auth/computers';
import type { TeamAgent } from '@service-auth/team-agents';
import type { Harness } from '@service-storage/client';
import { match } from 'ts-pattern';
import { setupStages } from '../computers/core/setup-progress';

/**
 * Whether an agent teammate can answer, as its row and its DM say it:
 * running, still being set up, stopped by a failed setup, on a computer that
 * is off or not connected, or not running for another reason.
 */
export type TeamAgentRunState =
  | 'running'
  | 'setting_up'
  | 'setup_failed'
  | 'offline'
  | 'not_running';

/**
 * The agent's state from its computer, and from its harness when the viewer
 * can see it. Only those who own the harness (the team's owner and admins)
 * see it, so for everyone else a running computer reads as running.
 */
export function teamAgentRunState(
  agent: Pick<TeamAgent, 'status'>,
  harness: Pick<Harness, 'connected'> | undefined
): TeamAgentRunState {
  return match(agent.status)
    .returnType<TeamAgentRunState>()
    .with('provisioning', () => 'setting_up')
    .with('failed', () => 'setup_failed')
    .with('paused', () => 'offline')
    .with('released', () => 'not_running')
    .with('running', () =>
      harness && !harness.connected ? 'offline' : 'running'
    )
    .exhaustive();
}

/**
 * The setup step an agent's computer is on, in the words of computer setup
 * ("Starting up"), while it is still being set up. The agent needs no Claude
 * sign-in to start, so that stage never counts.
 */
export function teamAgentSetupStep(
  computer: ComputerStatus | undefined
): string | undefined {
  if (!computer) return undefined;

  const current = setupStages(computer, {
    signIn: 'skipped',
    connected: false,
    signedIn: false,
  }).find((stage) => stage.state === 'current');
  return current?.label;
}

/** The agent's computer in the team's list, once it is bought. */
export function teamAgentComputer(
  agent: Pick<TeamAgent, 'computerId'>,
  computers: readonly ComputerStatus[] | undefined
): ComputerStatus | undefined {
  if (!agent.computerId) return undefined;
  return computers?.find((computer) => computer.id === agent.computerId);
}
