import kestrel from './assets/kestrel.svg';
import {
  brainEmailFixtureScope,
  createFixtureBrainEmailReader,
} from './brain-email-fixture';
import {
  type BrainObservation,
  type BrainReader,
  type BrainScope,
  type BrainSnapshot,
  visibleActivity,
} from './brain-model';
import { lifecycleLabel } from './fleet-data';
import { fleetBots, fleetViewer } from './fleet-fixture';
import { hireFleetPath, hireReceiptFor } from './hire-fixture';

export const fixtureViewer = fleetViewer.viewerId;
export const readBrainEmailFixture = createFixtureBrainEmailReader();

type Fixture = Pick<
  BrainSnapshot,
  'lifecycle' | 'workStatus' | 'statusSince'
> & {
  observations: readonly BrainObservation[];
};

const day = '2026-11-25';
const at = (time: string) => `${day}T${time}:00Z`;

const sableChecklist: BrainObservation = {
  id: 'component-checklist',
  title: 'Prepare the component readiness checklist',
  source: '#design-review',
  occurredAt: at('09:56'),
  observedAt: at('10:00'),
  outcome: 'Completed',
  visibility: 'visible',
  canOpen: true,
};

const samples: Readonly<Record<string, Fixture>> = {
  sable: {
    lifecycle: 'Ready',
    workStatus: 'Working',
    statusSince: { label: 'Active since', at: at('10:02') },
    observations: [
      sableChecklist,
      {
        id: 'dense-grid-padding',
        title: 'Verify dense grid table padding across desktop layouts',
        source: '#design-systems',
        occurredAt: '2026-11-24T16:40:00Z',
        observedAt: '2026-11-24T17:00:00Z',
        outcome: 'Completed',
        visibility: 'visible',
        canOpen: true,
      },
      {
        id: 'panel-contrast',
        title: 'Audit dense panel contrast and focus ring visibility',
        source: '#design-review',
        occurredAt: at('10:02'),
        observedAt: at('10:02'),
        outcome: 'Working',
        visibility: 'visible',
        canOpen: true,
      },
      sableChecklist,
      {
        id: 'desktop-baseline',
        title: 'Confirm dark card corners and header alignment',
        source: '#design-systems',
        occurredAt: at('09:18'),
        observedAt: at('09:30'),
        outcome: 'Completed',
        visibility: 'visible',
        canOpen: true,
      },
      {
        id: 'restricted-source',
        title: 'Restricted fixture observation',
        source: '#restricted-fixture',
        occurredAt: at('10:14'),
        observedAt: at('10:30'),
        outcome: 'Completed',
        visibility: 'denied',
        canOpen: true,
      },
    ],
  },
  quill: {
    lifecycle: 'Healthy',
    workStatus: 'Out of Office',
    statusSince: { label: 'Out of Office since', at: at('09:55') },
    observations: [
      {
        id: 'weekly-launch',
        title: 'Collect the weekly launch readiness updates',
        source: '#launch-ops',
        occurredAt: at('09:50'),
        observedAt: at('09:50'),
        outcome: 'Queued',
        visibility: 'visible',
        canOpen: false,
      },
      {
        id: 'release-summary',
        title: 'Publish the desktop layout release notes summary',
        source: '#release-notes',
        occurredAt: at('09:40'),
        observedAt: at('09:55'),
        outcome: 'Completed',
        visibility: 'visible',
        canOpen: true,
      },
    ],
  },
  kestrel: {
    lifecycle: 'Setting up',
    workStatus: 'Unavailable',
    statusSince: { label: 'Profile created', at: at('10:02') },
    observations: [],
  },
};

function isFixtureScope(scope: BrainScope) {
  return scope.viewer === fixtureViewer && scope.team === fleetViewer.teamId;
}

function provisioningReceipt(scope: BrainScope) {
  const receipt = hireReceiptFor(scope.team, scope.agent);
  if (receipt?.agent.status === 'provisioning') return receipt;
}

export function admitBrainFixture(scope: BrainScope) {
  return (
    isFixtureScope(scope) &&
    (scope.agent === brainEmailFixtureScope.agent ||
      scope.agent === 'kestrel' ||
      fleetBots.some(({ id }) => id === scope.agent) ||
      Boolean(provisioningReceipt(scope)))
  );
}

export const readBrainFixture: BrainReader = async (scope) => {
  if (!isFixtureScope(scope)) return { status: 'unavailable' };

  const receipt = provisioningReceipt(scope);
  if (receipt) {
    const { agent } = receipt;
    return {
      status: 'ready',
      snapshot: {
        scope,
        name: agent.name,
        role: agent.jobDescription,
        portrait: receipt.portrait,
        portraitWidth: receipt.width,
        fleetSearch: hireFleetPath(agent).slice('/fleet'.length),
        teamName: fleetViewer.teamName,
        lifecycle: lifecycleLabel[agent.status],
        setupPending: true,
        workStatus: 'Unavailable',
        statusSince: { label: 'Profile created', at: agent.createdAt },
        activity: [],
      },
    };
  }

  if (scope.agent === brainEmailFixtureScope.agent) {
    return {
      status: 'ready',
      snapshot: {
        scope,
        name: 'Finch',
        role: 'Release & handoff assistant',
        teamName: fleetViewer.teamName,
        lifecycle: 'Ready',
        workStatus: 'Unavailable',
        activity: [],
      },
    };
  }

  const bot =
    scope.agent === 'kestrel'
      ? {
          name: 'Kestrel',
          role: 'Team Bot',
          portrait: kestrel,
          status: 'provisioning' as const,
        }
      : fleetBots.find(({ id }) => id === scope.agent);

  if (!bot) return { status: 'unavailable' };

  const sample = Object.hasOwn(samples, scope.agent)
    ? samples[scope.agent]
    : undefined;
  return {
    status: 'ready',
    snapshot: {
      scope,
      name: bot.name,
      role: scope.agent === 'sable' ? 'Design Review Bot' : bot.role,
      portrait: bot.portrait,
      teamName: fleetViewer.teamName,
      lifecycle: sample?.lifecycle ?? lifecycleLabel[bot.status],
      setupPending: bot.status === 'provisioning' || bot.status === 'starting',
      workStatus: sample?.workStatus ?? 'Unavailable',
      statusSince: sample?.statusSince,
      journalDay: sample ? day : undefined,
      activity: sample ? visibleActivity(sample.observations) : [],
    },
  };
};
