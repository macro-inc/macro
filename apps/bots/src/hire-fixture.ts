import type { TeamAgent } from '@macro-inc/sdk/generated/auth';
import { createSignal } from 'solid-js';
import type { CheckoutAdapter } from './hire';

const team = 'sample-team';
type HireReceipt = {
  agent: Readonly<TeamAgent>;
  portrait: string;
  width: number;
};

const accepted = new Map<string, TeamAgent>();

const [receipt, setReceipt] = createSignal<HireReceipt>();
export const hireReceipt = receipt;

export function saveHireReceipt(value: HireReceipt) {
  if (value.agent.teamId !== team || value.agent.status !== 'provisioning') {
    return;
  }
  for (const agent of accepted.values()) {
    if (agent === value.agent) {
      setReceipt({ ...value, agent: Object.freeze({ ...agent }) });
      return;
    }
  }
}

export function hireFleetPath(agent: Pick<TeamAgent, 'teamId' | 'userId'>) {
  return `/fleet?${new URLSearchParams({ team: agent.teamId, bot: agent.userId })}`;
}

export function hireReceiptFor(teamId: string, userId: string) {
  const current = hireReceipt();
  if (current?.agent.teamId === teamId && current.agent.userId === userId) {
    return current;
  }
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
    return {
      status: 'signed-in',
      account: 'hire-fixture-account',
      session: 'hire-fixture-session',
      team,
      teamName: 'Sample Team',
      role: 'owner',
      teammatesEnabled: true,
      computersEnabled: true,
    };
  },
  async readOffers() {
    return {
      status: 'quoted',
      offers: {
        renewsAt: '2027-01-02T00:00:00Z',
        sizes: [
          {
            size: 'standard',
            vcpus: 2,
            memoryGb: 4,
            diskGb: 32,
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
            vcpus: 4,
            memoryGb: 8,
            diskGb: 64,
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
            vcpus: 8,
            memoryGb: 16,
            diskGb: 128,
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
  async submit({ request }) {
    const existing = accepted.get(request.purchaseKey);
    if (existing) return { status: 'accepted', agent: existing };

    const agent: TeamAgent = {
      teamId: team,
      userId: `fixture-${crypto.randomUUID()}`,
      computerId: crypto.randomUUID(),
      name: request.name,
      jobDescription: request.jobDescription ?? '',
      personality: request.personality ?? '',
      status: 'provisioning',
      createdAt: '2026-12-01T00:00:00Z',
    };
    accepted.set(request.purchaseKey, agent);
    return { status: 'accepted', agent };
  },
};
