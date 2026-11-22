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
      .with('engineUnreachable', () =>
        t('teammateHosts.hostEngineUnreachable', {
          engine: unreachableEngineName(host),
        })
      )
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

/** The engine a machine couldn't reach: the one it uses, else the first installed. */
function unreachableEngineName(host: TeammateHost): string {
  const kind = host.report?.engine?.kind ?? host.report?.engines[0]?.kind;
  if (!kind) return t('teammateHosts.engineEither');
  return engineName(kind);
}

function engineName(kind: 'docker' | 'podman'): string {
  return match(kind)
    .with('docker', () => 'Docker')
    .with('podman', () => 'Podman')
    .exhaustive();
}

/** Whether the machine's engine didn't answer: it may answer by itself soon. */
export function hostEngineUnreachable(host: TeammateHost): boolean {
  return (
    !host.eligibility.ok && host.eligibility.reason === 'engineUnreachable'
  );
}

/** The machine's engine, e.g. "Podman 5.2.0 · rootless", if it reported one. */
export function hostEngineLabel(host: TeammateHost): string | undefined {
  const engine = host.report?.engine;
  if (!engine) return undefined;
  const name = engineName(engine.kind);
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
 * Whether the viewer, an admin, may move an agent to one of their machines:
 * only the admin who invited it, or the owner of the machine it runs on now.
 * A parked agent's new machine gets its key, DMs and shares, so it may be
 * moved only by its inviter, the team's owner, or the owner of the machine
 * it was parked off once that machine may host it again (still paired, so
 * among the viewer's own). The service enforces the same rule.
 */
export function canMoveTeammate(
  agent: {
    createdBy?: string | null;
    harnessId?: string | null;
    installProblem?: InstallProblem | null;
  },
  viewerId: string | undefined,
  ownHarnessIds: readonly string[],
  viewer: { ownsTeam: boolean }
): boolean {
  if (!agent.harnessId || !viewerId) return false;
  const parked = agent.installProblem?.kind === 'hostRemoved';
  return (
    agent.createdBy === viewerId ||
    (parked && viewer.ownsTeam) ||
    ownHarnessIds.includes(agent.harnessId)
  );
}

/**
 * Which of the owner's machines an agent's row names: the one it runs on,
 * the one it is moving to while the old one saves its memory, or none
 * while it is parked off a machine (or runs on a Macro computer).
 */
export type TeammatePlacement =
  | { kind: 'on'; harnessId: string }
  | { kind: 'movingTo'; harnessId: string }
  | { kind: 'nowhere' };

export function teammatePlacement(agent: {
  status: string;
  harnessId?: string | null;
  movingTo?: string | null;
  installProblem?: InstallProblem | null;
}): TeammatePlacement {
  if (agent.status === 'moving' && agent.movingTo)
    return { kind: 'movingTo', harnessId: agent.movingTo };
  if (!agent.harnessId || agent.installProblem?.kind === 'hostRemoved')
    return { kind: 'nowhere' };
  return { kind: 'on', harnessId: agent.harnessId };
}
