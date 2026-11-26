import type { BillingReader, BillingTeam } from './read';

export const sampleTeam: BillingTeam = {
  id: 'billing-sample-team',
  name: 'Sample team',
};

const dailyHours = [
  0, 0, 7, 8, 7, 8, 6, 0, 0, 8, 8, 7, 8, 7, 0, 0, 7, 8, 7, 7, 7, 0, 0, 7, 7,
];
const sableHours = [
  0, 0, 5, 5, 5, 5, 5, 0, 0, 5, 5, 5, 5, 5, 0, 0, 4, 4, 4, 4, 4, 0, 0, 4, 4,
];

export function fixtureBilling(scenario: string | null): BillingReader {
  return async (team) => {
    if (team.id !== sampleTeam.id || scenario === 'denied') {
      return { status: 'denied' };
    }

    if (scenario === 'pending') {
      return { status: 'pending' };
    }

    const sampleSableHours =
      scenario === 'zero' ? dailyHours.map(() => 0) : sableHours;
    const sampleQuillHours =
      scenario === 'zero'
        ? sampleSableHours
        : dailyHours.map((hours, day) => hours - sableHours[day]);

    return {
      status: 'ready',
      value: {
        usage:
          scenario === 'empty'
            ? { status: 'empty' }
            : {
                status: 'ready',
                value: {
                  currency: 'USD',
                  cycle: {
                    start: '2026-11-01',
                    end: '2026-11-30',
                    status: 'open',
                  },
                  observedThrough: '2026-11-25',
                  agents: [
                    {
                      name: 'Sable',
                      rateMinor: 1500,
                      startedHoursByDay: sampleSableHours,
                    },
                    {
                      name: 'Quill',
                      rateMinor: 1500,
                      startedHoursByDay: sampleQuillHours,
                    },
                  ],
                  billedMinor: { status: 'ready', value: 0 },
                },
              },
        invoices:
          scenario === 'empty'
            ? { status: 'empty' }
            : {
                status: 'ready',
                value: {
                  currency: 'USD',
                  nextInvoice: { amount: 30000, date: '2026-12-01' },
                },
              },
        modeledSpend: { status: scenario === 'empty' ? 'empty' : 'pending' },
      },
    };
  };
}
