import { t } from '@app/lib/i18n';
import type { TeamAgentStatus } from '@service-auth/team-agents';
import { match } from 'ts-pattern';

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
  failure: InstallFailure | undefined,
  status: TeamAgentStatus,
  host: string
): string | undefined {
  if (!failure) return undefined;
  // A failed update leaves the previous version running.
  if (status === 'running' || status === 'starting')
    return match(failure)
      .with('crashLoop', () => t('teamAgents.rolledBackCrashLoop'))
      .with('imageUnavailable', () =>
        t('teamAgents.rolledBackImageUnavailable')
      )
      .otherwise(() => t('teamAgents.rolledBackOther'));
  return match(failure)
    .with('imageUnavailable', () =>
      t('teamAgents.failedImageUnavailable', { host })
    )
    .with('imageMismatch', () => t('teamAgents.failedImageMismatch', { host }))
    .with('engineRefused', () => t('teamAgents.failedEngineRefused', { host }))
    .with('badConfiguration', () =>
      t('teamAgents.failedBadConfiguration', { host })
    )
    .with('incompatibleRuntime', () =>
      t('teamAgents.failedIncompatibleRuntime', { host })
    )
    .with('crashLoop', () => t('teamAgents.failedCrashLoop', { host }))
    .with('hostUnsupported', () =>
      t('teamAgents.failedHostUnsupported', { host })
    )
    .exhaustive();
}
