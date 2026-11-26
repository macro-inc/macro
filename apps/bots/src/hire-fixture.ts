import { createSignal } from 'solid-js';
import type { CheckoutAdapter } from './hire';

const team = 'hire-fixture-team';
const [receipt, setReceipt] = createSignal<{
  name: string;
  portrait: string;
  width: number;
}>();
export const hireReceipt = receipt;
export const saveHireReceipt = setReceipt;

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
    return {
      status: 'accepted',
      agent: {
        teamId: team,
        userId: request.purchaseKey,
        computerId: request.purchaseKey,
        name: request.name,
        jobDescription: request.jobDescription ?? '',
        personality: request.personality ?? '',
        status: 'provisioning',
        createdAt: '2026-12-01T00:00:00Z',
      },
    };
  },
};
