import { t } from '@app/lib/i18n';
import type { InstallProblem } from '@service-auth/generated/schemas/installProblem';
import { match } from 'ts-pattern';

/**
 * The line under an agent's status saying why its own machine couldn't run
 * it, or that it went back to the version it ran before. `undefined` when
 * there is nothing to say.
 */
export function installProblemLine(
  problem: InstallProblem | null | undefined,
  host: string
): string | undefined {
  if (!problem) return undefined;
  return match(problem)
    .with({ kind: 'hostRemoved' }, () => t('teamAgents.hostRemoved', { host }))
    .with({ kind: 'rolledBack' }, ({ reason }) =>
      match(reason)
        .with('crashLoop', () => t('teamAgents.rolledBackCrashLoop'))
        .with('imageUnavailable', () =>
          t('teamAgents.rolledBackImageUnavailable')
        )
        .otherwise(() => t('teamAgents.rolledBackOther'))
    )
    .with({ kind: 'failed' }, ({ reason }) =>
      match(reason)
        .with('imageUnavailable', () =>
          t('teamAgents.failedImageUnavailable', { host })
        )
        .with('imageMismatch', () =>
          t('teamAgents.failedImageMismatch', { host })
        )
        .with('engineRefused', () =>
          t('teamAgents.failedEngineRefused', { host })
        )
        .with('badConfiguration', () =>
          t('teamAgents.failedBadConfiguration', { host })
        )
        .with('incompatibleRuntime', () =>
          t('teamAgents.failedIncompatibleRuntime', { host })
        )
        .with('crashLoop', () => t('teamAgents.failedCrashLoop', { host }))
        .with('networkIsolationUnavailable', () =>
          t('teamAgents.failedNetworkIsolation', { host })
        )
        .with('egressBlocked', () =>
          t('teamAgents.failedEgressBlocked', { host })
        )
        .with('hostUnsupported', () =>
          t('teamAgents.failedHostUnsupported', { host })
        )
        .exhaustive()
    )
    .exhaustive();
}
