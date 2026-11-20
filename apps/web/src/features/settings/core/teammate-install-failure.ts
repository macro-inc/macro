import type { TeamAgentStatus } from '@service-auth/team-agents';

/**
 * Why the machine an agent runs on gave up on its runtime, as the team
 * agent response reports it (`installFailure`).
 */
export type InstallFailure =
  | 'imageUnavailable'
  | 'imageMismatch'
  | 'engineRefused'
  | 'badConfiguration'
  | 'incompatibleRuntime'
  | 'crashLoop'
  | 'hostUnsupported';

/**
 * The line under an agent's status saying why its own machine couldn't run
 * it, or that it went back to the previous version. `undefined` when there
 * is nothing to say.
 */
export function installFailureLine(
  _failure: InstallFailure | undefined,
  _status: TeamAgentStatus,
  _host: string
): string | undefined {
  return undefined;
}
