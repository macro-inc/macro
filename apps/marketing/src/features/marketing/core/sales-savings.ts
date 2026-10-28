import {
  annualPlanPrice,
  macroAnnualCost,
  SAVINGS_TOOLS,
  type SavingsTool,
  type SavingsToolId,
} from './savings-calculator';

/**
 * The `/tour` ad landing page simplifies the pricing calculator: one plan tier
 * for every tool instead of a plan per tool. Prices come from
 * `savings-calculator.ts`, so both pages quote the same numbers.
 */
export type SalesTier = 'starter' | 'business';

/** The tools the page leads with; the rest of the calculator's tools start off. */
export const SALES_HEADLINE_TOOLS: readonly SavingsToolId[] = [
  'notion',
  'linear',
  'superhuman',
  'slack',
];

export const SALES_DEFAULT_SEATS = 5;
export const SALES_DEFAULT_TIER: SalesTier = 'business';

export function salesTool(id: SavingsToolId): SavingsTool {
  const tool = SAVINGS_TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`Unknown savings tool: ${id}`);
  return tool;
}

/** Each tool lists its entry plan first and its business plan second. */
export function tierPlan(tool: SavingsTool, tier: SalesTier) {
  return tool.plans[tier === 'starter' ? 0 : 1];
}

/** Per-seat monthly price, in cents, of a tool on the chosen tier. */
export function tierMonthlyCents(tool: SavingsTool, tier: SalesTier): number {
  return tierPlan(tool, tier).monthlyCents;
}

export type SalesSavings = {
  /** Yearly cost of the selected tools for the whole team. */
  toolsCents: number;
  /** Yearly cost of Macro's paid plan for the whole team. */
  macroCents: number;
  /** Yearly difference; zero when Macro costs the same or more. */
  savedCents: number;
};

export function salesSavings(
  selected: readonly SavingsToolId[],
  seats: number,
  tier: SalesTier
): SalesSavings {
  const perSeatCents = selected.reduce((total, id) => {
    const tool = salesTool(id);
    return total + annualPlanPrice(tool, tierPlan(tool, tier).id);
  }, 0);
  const toolsCents = perSeatCents * seats;
  const macroCents = macroAnnualCost(seats);
  return {
    toolsCents,
    macroCents,
    savedCents: Math.max(0, toolsCents - macroCents),
  };
}

/** `$2,640`: the page rounds totals to whole dollars. */
export function formatWholeUsd(cents: number): string {
  return Math.round(cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
