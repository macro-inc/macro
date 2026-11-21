import { t } from '@app/lib/i18n';
import type { InstallProblem } from '@service-auth/generated/schemas/installProblem';
import type { TeammateHost } from '@service-auth/team-agents';
import { match, P } from 'ts-pattern';

/**
 * Why a machine can't host an agent, in the owner's words, or `undefined`
 * when it can.
 */
export function hostUnavailableReason(host: TeammateHost): string | undefined {
  const { eligibility } = host;
  if (eligibility.ok) return undefined;
  return (
    match(eligibility.reason)
      .with('offline', () => t('teammateHosts.hostOffline'))
      .with('notReported', () => t('teammateHosts.hostNotReported'))
      .with('noEngine', () => t('teammateHosts.hostNoEngine'))
      .with('engineUnreachable', () => t('teammateHosts.hostEngineUnreachable'))
      .with('unsupportedPlatform', () =>
        t('teammateHosts.hostUnsupportedPlatform')
      )
      .with('belowFloor', () =>
        match(eligibility.resource)
          .with('cpus', () => t('teammateHosts.hostBelowFloorCpus'))
          .with('memory', () => t('teammateHosts.hostBelowFloorMemory'))
          .with('disk', () => t('teammateHosts.hostBelowFloorDisk'))
          .with(P.nullish, () => t('teammateHosts.hostNotEligible'))
          .exhaustive()
      )
      .with('innerSandboxUnavailable', () =>
        t('teammateHosts.hostInnerSandbox')
      )
      .with('networkIsolationUnavailable', () =>
        t('teammateHosts.hostNetworkIsolation')
      )
      // A reason a newer server adds still reads as unavailable.
      .with(P.nullish, () => t('teammateHosts.hostNotEligible'))
      .exhaustive()
  );
}

/** The machine's engine, e.g. "Podman 5.2.0 · rootless", if it reported one. */
export function hostEngineLabel(host: TeammateHost): string | undefined {
  const engine = host.report?.engine;
  if (!engine) return undefined;
  const name = match(engine.kind)
    .with('docker', () => 'Docker')
    .with('podman', () => 'Podman')
    .exhaustive();
  const label = t('teammateHosts.hostEngine', {
    engine: name,
    version: engine.version,
  });
  return engine.rootless
    ? `${label} · ${t('teammateHosts.hostRootless')}`
    : label;
}

/** Machines that can host an agent first, then the rest, each by name. */
export function sortedHosts(
  hosts: readonly TeammateHost[]
): readonly TeammateHost[] {
  return [...hosts].sort(
    (left, right) =>
      Number(right.eligibility.ok) - Number(left.eligibility.ok) ||
      left.name.localeCompare(right.name)
  );
}

/** The machine an owner can pick first, if any. */
export function firstEligibleHost(
  hosts: readonly TeammateHost[]
): TeammateHost | undefined {
  return sortedHosts(hosts).find((host) => host.eligibility.ok);
}

/** The Remove confirmation's body for an agent on one of the owner's machines. */
export function ownMachineRemoveBody(hostName: string): string {
  return t('teammateHosts.removeBodyOwn', { host: hostName });
}

/**
 * Whether the viewer may move an agent to another of their machines: only
 * the admin who invited it, or the owner of the machine it runs on now. A
 * parked agent (its machine may no longer host it) runs nowhere, so any
 * admin may. The service enforces the same rule.
 */
export function canMoveTeammate(
  agent: {
    createdBy?: string | null;
    harnessId?: string | null;
    installProblem?: InstallProblem | null;
  },
  viewerId: string | undefined,
  ownHarnessIds: readonly string[]
): boolean {
  if (!agent.harnessId || !viewerId) return false;
  return (
    agent.installProblem?.kind === 'hostRemoved' ||
    agent.createdBy === viewerId ||
    ownHarnessIds.includes(agent.harnessId)
  );
}
