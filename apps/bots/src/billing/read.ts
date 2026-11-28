import type { SubscriptionBilling, Team } from '@macro-inc/sdk/generated/auth';

export type BillingTeam = Pick<Team, 'id' | 'name'>;

export type BillingReading<T> =
  | { status: 'pending' | 'denied' | 'empty' | 'unavailable' }
  | { status: 'ready'; value: T };

export type AgentWork = {
  name: string;
  rateMinor: number;
  // One entry for each UTC date from cycle start through observedThrough, inclusive.
  startedHoursByDay: readonly number[];
};

export type StartedHourUsage = {
  currency: string;
  cycle: { start: string; end: string; status: 'open' | 'closed' };
  observedThrough: string;
  agents: readonly AgentWork[];
  billedMinor: BillingReading<number>;
};

export type RecurringInvoice = Pick<
  SubscriptionBilling,
  'currency' | 'nextInvoice'
>;

export type ModeledSpend = {
  currency: string;
  start: string;
  end: string;
  agents: readonly { name: string; amountMinor: number }[];
};

export type BillingSnapshot = {
  usage: BillingReading<StartedHourUsage>;
  invoices: BillingReading<RecurringInvoice>;
  modeledSpend: BillingReading<ModeledSpend>;
};

export type BillingReader = (
  team: BillingTeam
) => Promise<BillingReading<BillingSnapshot>>;

export const unavailableBilling: BillingReader = async () => ({
  status: 'unavailable',
});
