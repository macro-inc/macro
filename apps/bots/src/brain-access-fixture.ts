import type {
  AccessKind,
  AccessOutcome,
  AccessRecord,
  AccessRequest,
  BrainAccessSource,
} from './brain-access-source';
import type { BrainScope } from './brain-model';

const teamId = 'sample-team';

export type BrainAccessFixtureViewer = {
  teamId: string;
  teamName: string;
  viewerId: string;
  role: 'admin' | 'owner' | 'member';
};

const viewers = {
  admin: 'Team admin',
  owner: 'Item owner',
  member: 'Team member',
};

type AgentRecord = {
  name: string;
  settingUp: boolean;
  records: readonly AccessRecord[];
  requests: readonly AccessRequest[];
};

const agents = new Map<string, AgentRecord>([
  [
    'sable',
    {
      name: 'Sable',
      settingUp: false,
      records: [
        {
          itemId: 'figma',
          name: 'Figma Design Library',
          state: 'granted',
          level: 'View',
          standing: true,
          updatedAt: 'Today 08:15',
        },
        {
          itemId: 'linear',
          name: 'Linear Issue Tracker',
          state: 'granted',
          level: 'Edit',
          standing: true,
          updatedAt: 'Yesterday',
        },
        {
          itemId: 'github',
          name: 'GitHub Docs Repo',
          state: 'pending',
          level: 'View',
          updatedAt: 'Today 09:38',
        },
        {
          itemId: 'portal',
          name: 'Customer Feedback Portal',
          state: 'no-access',
          updatedAt: 'Nov 22',
        },
      ],
      requests: [
        {
          id: 'req-sable-storybook',
          kind: 'login',
          name: 'Staging Storybook',
          level: 'View',
          reason:
            'Needed to verify dark-surface contrast tokens in the staging component preview.',
          requestedAt: 'Today 10:04 AM',
        },
        {
          id: 'req-sable-font-card',
          kind: 'card',
          name: 'Cloud Font License Card',
          reason:
            'Match the team billing card for annual typography license renewal.',
          requestedAt: 'Today 09:51 AM',
        },
      ],
    },
  ],
  [
    'quill',
    {
      name: 'Quill',
      settingUp: false,
      records: [
        {
          itemId: 'docs-export',
          name: 'Docs Export Workspace',
          state: 'pending',
          level: 'View',
          updatedAt: 'Today 08:50',
        },
      ],
      requests: [
        {
          id: 'req-quill-cdn',
          kind: 'login',
          name: 'Release Notes CDN',
          level: 'View',
          reason:
            'Needed to pull published release asset links before posting the release notes recap.',
          requestedAt: 'Today 09:32 AM',
        },
      ],
    },
  ],
  ['kestrel', { name: 'Kestrel', settingUp: true, records: [], requests: [] }],
]);

const vault: readonly {
  id: string;
  name: string;
  teamId: string;
  kind: AccessKind;
  managerId: string;
}[] = [
  {
    id: 'github',
    name: 'GitHub Docs Repo',
    teamId,
    kind: 'login',
    managerId: 'preview-owner',
  },
  {
    id: 'linear',
    name: 'Linear Issue Tracker',
    teamId,
    kind: 'login',
    managerId: 'preview-admin',
  },
  {
    id: 'figma',
    name: 'Figma Design Library',
    teamId,
    kind: 'login',
    managerId: 'preview-designer',
  },
  {
    id: 'portal',
    name: 'Customer Feedback Portal',
    teamId,
    kind: 'login',
    managerId: 'preview-admin',
  },
  {
    id: 'ops-card',
    name: 'Design Ops Virtual Card',
    teamId,
    kind: 'card',
    managerId: 'preview-admin',
  },
  {
    id: 'webhook-api',
    name: 'Team Webhook API',
    teamId,
    kind: 'api',
    managerId: 'preview-admin',
  },
  {
    id: 'foreign-login',
    name: 'Other Team Login',
    teamId: 'other-team',
    kind: 'login',
    managerId: 'preview-owner',
  },
  {
    id: 'foreign-card',
    name: 'Other Team Card',
    teamId: 'other-team',
    kind: 'card',
    managerId: 'preview-admin',
  },
];

export function createBrainAccessFixture({
  teamId: viewerTeamId,
  teamName,
  viewerId,
  role,
}: BrainAccessFixtureViewer): BrainAccessSource {
  const outcomes = new Map<string, AccessOutcome>();
  const linkedItems = new Map<AgentRecord, Set<string>>();
  const viewerLabel = Object.hasOwn(viewers, role) ? viewers[role] : undefined;
  const isAdmin = role === 'admin';

  function findAgent(scope: BrainScope) {
    if (
      !viewerLabel ||
      !viewerId ||
      scope.viewer !== viewerId ||
      scope.team !== teamId ||
      scope.team !== viewerTeamId
    )
      return;
    return agents.get(scope.agent);
  }

  function choicesFor(agent: AgentRecord, request: AccessRequest) {
    return vault.filter(
      (item) =>
        item.teamId === teamId &&
        item.kind === request.kind &&
        (isAdmin || item.managerId === viewerId) &&
        !linkedItems.get(agent)?.has(item.id) &&
        !agent.records.some(
          (record) => record.itemId === item.id && record.state === 'granted'
        )
    );
  }

  return {
    read(scope) {
      const agent = findAgent(scope);
      if (!agent) return;

      return {
        agentName: agent.name,
        teamName,
        settingUp: agent.settingUp,
        viewerLabel: viewers[role],
        canResolveItemless: isAdmin,
        records: agent.records.map((record) => ({ ...record })),
        reviews: agent.requests.map((request) => {
          const outcome = outcomes.get(request.id);
          return {
            request: { ...request },
            choices: choicesFor(agent, request).map(({ id, name }) => ({
              id,
              name,
            })),
            outcome: outcome && { ...outcome },
          };
        }),
      };
    },
    decide(scope, decision) {
      const agent = findAgent(scope);
      const request = agent?.requests.find(
        ({ id }) => id === decision.requestId
      );
      if (!agent || !request) return 'unavailable';
      if (outcomes.has(request.id)) return 'denied';

      switch (decision.action) {
        case 'link': {
          const item = choicesFor(agent, request).find(
            ({ id }) => id === decision.itemId
          );
          if (!item) return 'denied';

          if (request.kind === 'card') {
            outcomes.set(request.id, { state: 'awaiting-human' });
          } else {
            const held = linkedItems.get(agent) ?? new Set<string>();
            held.add(item.id);
            linkedItems.set(agent, held);
            outcomes.set(request.id, { state: 'linked', itemName: item.name });
          }
          break;
        }
        case 'add':
          if (
            !isAdmin ||
            !decision.itemName.trim() ||
            decision.itemName.length > 64
          ) {
            return 'denied';
          }
          outcomes.set(request.id, {
            state: request.kind === 'card' ? 'awaiting-human' : 'added',
          });
          break;
        case 'decline':
          if (!isAdmin) return 'denied';
          outcomes.set(request.id, { state: 'declined' });
          break;
        default:
          return 'denied';
      }
      return 'resolved';
    },
  };
}
