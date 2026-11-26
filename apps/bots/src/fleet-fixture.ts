import type { ComputerStatus, TeamAgent } from '@macro-inc/sdk/generated/auth';
import atlas from './assets/atlas.svg';
import echoPreset from './assets/echo.svg';
import ledger from './assets/ledger.svg';
import quill from './assets/quill.svg';
import sable from './assets/sable.svg';
import scout from './assets/scout.svg';
import {
  type FleetReadPorts,
  type FleetViewer,
  sameFleetScope,
} from './fleet-data';
import { hireReceipt, selectedHireReceipt } from './hire-fixture';

export const fleetViewer: FleetViewer = {
  viewerId: 'hire-fixture-account',
  teamId: 'sample-team',
  teamName: 'Northstar Design',
  role: 'owner',
  teammateRollout: 'on',
  computerRollout: 'on',
};

export const fleetBots: readonly {
  id: string;
  name: string;
  role: string;
  portrait: string;
  status: TeamAgent['status'];
}[] = [
  {
    id: 'sable',
    name: 'Sable',
    role: 'Design & handoff teammate',
    portrait: sable,
    status: 'running',
  },
  {
    id: 'quill',
    name: 'Quill',
    role: 'Call recap assistant',
    portrait: quill,
    status: 'paused',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Project research',
    portrait: atlas,
    status: 'starting',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    role: 'Operations review',
    portrait: ledger,
    status: 'unhealthy',
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'Customer research',
    portrait: scout,
    status: 'failed',
  },
  {
    id: 'finch',
    name: 'Finch',
    role: 'Release & handoff assistant',
    portrait: echoPreset,
    status: 'running',
  },
];

export function fleetFixture(search: string) {
  const query = new URLSearchParams(search);
  const example = query.get('example');
  const selectingHire = query.has('team') || query.has('bot');
  const selectedHire = selectedHireReceipt(search);
  if (selectingHire && selectedHire?.agent.teamId !== fleetViewer.teamId)
    return null;

  const currentHire = hireReceipt();
  const teammate =
    currentHire?.agent.teamId === fleetViewer.teamId ? currentHire : undefined;
  const agents = (example === 'empty' ? [] : fleetBots).map(
    (bot): TeamAgent => ({
      userId: bot.id,
      teamId: fleetViewer.teamId,
      computerId: bot.status === 'released' ? null : `vm-${bot.id}`,
      createdAt: '2026-01-01T09:00:00Z',
      name: bot.name,
      jobDescription: bot.role,
      personality: '',
      status: bot.status,
    })
  );
  if (teammate) {
    if (agents.some((agent) => agent.userId === teammate.agent.userId))
      return null;
    agents.push(teammate.agent);
  }

  const computers: ComputerStatus[] = [
    {
      id: 'vm-sable',
      name: 'Sable computer',
      createdAt: '2026-01-01T09:00:00Z',
      purchasedBy: fleetViewer.viewerId,
      catalogEntry: 'fixture-standard',
      size: 'standard',
      diskGib: 100,
      vcpus: 4,
      memoryGib: 8,
      poweredOn: true,
      status: 'ready',
      agentCount: 1,
      canRestore: false,
      canUndoCancel: false,
    },
  ];

  const reads: FleetReadPorts = {
    async readRoster(scope) {
      if (!sameFleetScope(scope, fleetViewer) || example === 'denied') {
        return { status: 'denied' };
      }
      if (example === 'roster-outage') return { status: 'unavailable' };
      return { status: 'ready', scope, value: { agents } };
    },
    async readComputers(scope) {
      if (!sameFleetScope(scope, fleetViewer)) return { status: 'denied' };
      if (example === 'compute-outage') return { status: 'unavailable' };
      return { status: 'ready', scope, value: computers };
    },
  };

  const portraits = new Map<string, { src: string; width: number }>(
    fleetBots.map((bot) => [bot.id, { src: bot.portrait, width: 0 }])
  );
  if (teammate) {
    portraits.set(teammate.agent.userId, {
      src: teammate.portrait,
      width: teammate.width,
    });
  }

  return {
    reads,
    viewer: fleetViewer,
    portraits,
    selected:
      selectedHire?.agent.userId ?? (example === 'hire' ? 'atlas' : null),
  };
}
