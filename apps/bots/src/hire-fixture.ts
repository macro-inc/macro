import type { CreateTeamAgent, TeamAgent } from '@macro-inc/sdk/generated/auth';
import { createSignal } from 'solid-js';
import { sampleResources } from './creator-profile';
import { type Draft, draftName } from './draft';
import type { CheckoutAdapter, HireScope } from './hire';
import { fixtureTeam, fixtureTeamName } from './routes';

const scope: Extract<HireScope, { status: 'signed-in' }> = {
  status: 'signed-in',
  account: 'hire-fixture-account',
  session: 'hire-fixture-session',
  team: fixtureTeam,
  teamName: fixtureTeamName,
  role: 'owner',
  teammatesEnabled: true,
  computersEnabled: true,
};

function admits(buyer: typeof scope) {
  return (
    buyer.team === scope.team &&
    buyer.account === scope.account &&
    buyer.session === scope.session &&
    buyer.role === scope.role &&
    buyer.teammatesEnabled &&
    buyer.computersEnabled
  );
}

type HireReceipt = {
  agent: Readonly<TeamAgent>;
  draft: Draft;
  portrait: string;
};

const accepted = new Map<
  string,
  { agent: TeamAgent; request: Readonly<CreateTeamAgent> }
>();

const [receipts, setReceipts] = createSignal<readonly HireReceipt[]>([]);
export const hireReceipts = receipts;

export function saveHireReceipt(value: HireReceipt) {
  if (
    value.agent.teamId !== fixtureTeam ||
    value.agent.status !== 'provisioning'
  ) {
    return;
  }
  for (const { agent, request } of accepted.values()) {
    if (
      agent === value.agent &&
      request.name === draftName(value.draft) &&
      request.size === value.draft.size
    ) {
      if (hireReceiptFor(agent.teamId, agent.userId)) return;

      const draft = Object.freeze({
        ...value.draft,
        look: Object.freeze({ ...value.draft.look }),
      });
      const receipt = Object.freeze({
        ...value,
        draft,
        agent: Object.freeze({ ...agent }),
      });
      setReceipts((previous) => [...previous, receipt]);
      return;
    }
  }
}

export function hireFleetPath(agent: Pick<TeamAgent, 'teamId' | 'userId'>) {
  return `/fleet?${new URLSearchParams({ team: agent.teamId, bot: agent.userId })}`;
}

export function hireReceiptFor(teamId: string, userId: string) {
  return hireReceipts().find(
    ({ agent }) => agent.teamId === teamId && agent.userId === userId
  );
}

export function selectedHireReceipt(search: string) {
  const params = new URLSearchParams(search);
  const teams = params.getAll('team');
  const bots = params.getAll('bot');
  if (params.size === 2 && teams.length === 1 && bots.length === 1) {
    return hireReceiptFor(teams[0], bots[0]);
  }
}

export const fixtureCheckout: CheckoutAdapter = {
  async readScope() {
    return { ...scope };
  },
  async readOffers(buyer) {
    if (!admits(buyer)) return { status: 'denied' };

    return {
      status: 'quoted',
      offers: {
        renewsAt: '2027-01-02T00:00:00Z',
        sizes: [
          {
            size: 'standard',
            ...sampleResources.standard,
            dueToday: 700,
            soldOut: false,
            quote: {
              size: 'standard',
              amount: 1900,
              currency: 'usd',
              interval: 'month',
              priceId: 'fixture-standard',
            },
          },
          {
            size: 'large',
            ...sampleResources.large,
            dueToday: 1400,
            soldOut: false,
            quote: {
              size: 'large',
              amount: 3900,
              currency: 'usd',
              interval: 'month',
              priceId: 'fixture-large',
            },
          },
          {
            size: 'xl',
            ...sampleResources.xl,
            dueToday: 2800,
            soldOut: true,
            quote: {
              size: 'xl',
              amount: 7900,
              currency: 'usd',
              interval: 'month',
              priceId: 'fixture-xl',
            },
          },
        ],
      },
    };
  },
  async submit({ scope: buyer, request }) {
    if (!admits(buyer)) return { status: 'declined' };

    const existing = accepted.get(request.purchaseKey);
    if (existing) return { status: 'accepted', agent: existing.agent };

    const agent: TeamAgent = {
      teamId: fixtureTeam,
      userId: `fixture-${crypto.randomUUID()}`,
      computerId: crypto.randomUUID(),
      name: request.name,
      jobDescription: request.jobDescription ?? '',
      personality: request.personality ?? '',
      status: 'provisioning',
      createdAt: '2026-12-01T00:00:00Z',
    };
    accepted.set(request.purchaseKey, {
      agent,
      request: Object.freeze({ ...request }),
    });
    return { status: 'accepted', agent };
  },
};
