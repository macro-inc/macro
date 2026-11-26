import type {
  ListTeamAgentsResponse,
  ListTeamComputersResponse,
  TeamAgent,
  TeamRole,
} from '@macro-inc/sdk/generated/auth';

type Gate = 'on' | 'off' | 'unknown';
type Computer = ListTeamComputersResponse[number];

export type FleetScope = {
  viewerId: string;
  teamId: string;
};

export type FleetViewer = FleetScope & {
  teamName: string;
  role: TeamRole | null;
  teammateRollout: Gate;
  computerRollout: Gate;
};

type FleetRead<T> =
  | { status: 'ready'; scope: FleetScope; value: T }
  | { status: 'denied' | 'unavailable' };

export type FleetReadPorts = {
  readRoster(scope: FleetScope): Promise<FleetRead<ListTeamAgentsResponse>>;
  readComputers(
    scope: FleetScope
  ): Promise<FleetRead<ListTeamComputersResponse>>;
};

type FleetResult =
  | { status: 'denied' | 'unavailable' }
  | { status: 'ready'; agents: readonly TeamAgent[]; canHire: boolean };

export const offlineFleetReads: FleetReadPorts = {
  async readRoster() {
    return { status: 'unavailable' };
  },
  async readComputers() {
    return { status: 'unavailable' };
  },
};

export function sameFleetScope(left: FleetScope, right: FleetScope): boolean {
  return left.viewerId === right.viewerId && left.teamId === right.teamId;
}

export const lifecycleLabel = {
  provisioning: 'Setting up',
  starting: 'Setting up',
  running: 'Ready',
  paused: 'Paused',
  unhealthy: 'Degraded',
  failed: 'Failed',
  released: 'Unavailable',
} satisfies Record<TeamAgent['status'], string>;

export async function readFleetRoster(
  ports: FleetReadPorts,
  viewer: FleetViewer
): Promise<FleetResult> {
  if (!viewer.viewerId || !viewer.teamId || viewer.teammateRollout !== 'on') {
    return { status: 'denied' };
  }

  try {
    const roster = await ports.readRoster({
      viewerId: viewer.viewerId,
      teamId: viewer.teamId,
    });
    if (roster.status !== 'ready') return { status: roster.status };

    const { agents } = roster.value;
    if (
      !sameFleetScope(roster.scope, viewer) ||
      agents.some((agent) => agent.teamId !== viewer.teamId) ||
      new Set(agents.map((agent) => agent.userId)).size !== agents.length
    ) {
      return { status: 'denied' };
    }

    return {
      status: 'ready',
      agents,
      canHire:
        (viewer.role === 'admin' || viewer.role === 'owner') &&
        viewer.computerRollout === 'on',
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function readFleetComputers(
  ports: FleetReadPorts,
  viewer: FleetViewer
): Promise<ReadonlyMap<string, Computer>> {
  if (
    !viewer.viewerId ||
    !viewer.teamId ||
    viewer.teammateRollout !== 'on' ||
    viewer.computerRollout !== 'on'
  ) {
    return new Map();
  }

  try {
    const compute = await ports.readComputers({
      viewerId: viewer.viewerId,
      teamId: viewer.teamId,
    });
    if (compute.status === 'ready' && sameFleetScope(compute.scope, viewer)) {
      const byId = new Map(
        compute.value.map((computer) => [computer.id, computer])
      );
      if (byId.size === compute.value.length) return byId;
    }
  } catch {
    // Supplemental compute details must leave the roster usable.
  }
  return new Map();
}
