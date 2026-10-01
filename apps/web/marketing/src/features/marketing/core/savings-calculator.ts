/**
 * Per-seat prices for the pricing-page savings calculator. Prices are stored as
 * published (cents per seat per month) and compared as yearly team totals.
 *
 * Competitor prices are their public per-seat rates billed annually (their
 * lowest advertised price), checked against each pricing page in September
 * 2026. Jira publishes a small-team per-user rate rather than an annual one.
 * Macro's paid plan is $40 per seat for a team's first 5 seats, then $80.
 */
export const MACRO_SEAT_CENTS = 4000;
export const MACRO_EXTRA_SEAT_CENTS = 8000;
export const MACRO_DISCOUNTED_SEATS = 5;
export const MAX_SEATS = 10_000;

export const PRICES_CHECKED = 'September 2026';

export type SavingsPlan = {
  id: string;
  name: string;
  monthlyCents: number;
};

export type SavingsTool = {
  id:
    | 'notion'
    | 'linear'
    | 'jira'
    | 'asana'
    | 'clickup'
    | 'hubspot'
    | 'salesforce'
    | 'slack'
    | 'superhuman';
  name: string;
  plans: readonly [SavingsPlan, SavingsPlan];
};

export type SavingsToolId = SavingsTool['id'];

export const SAVINGS_TOOLS: readonly SavingsTool[] = [
  {
    id: 'notion',
    name: 'Notion',
    plans: [
      { id: 'plus', name: 'Plus', monthlyCents: 1000 },
      { id: 'business', name: 'Business', monthlyCents: 2000 },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    plans: [
      { id: 'basic', name: 'Basic', monthlyCents: 1000 },
      { id: 'business', name: 'Business', monthlyCents: 1600 },
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    plans: [
      { id: 'standard', name: 'Standard', monthlyCents: 791 },
      { id: 'premium', name: 'Premium', monthlyCents: 1454 },
    ],
  },
  {
    id: 'asana',
    name: 'Asana',
    plans: [
      { id: 'starter', name: 'Starter', monthlyCents: 1099 },
      { id: 'advanced', name: 'Advanced', monthlyCents: 2499 },
    ],
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    plans: [
      { id: 'unlimited', name: 'Unlimited', monthlyCents: 700 },
      { id: 'business', name: 'Business', monthlyCents: 1200 },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    plans: [
      { id: 'starter', name: 'Starter', monthlyCents: 900 },
      { id: 'professional', name: 'Professional', monthlyCents: 9000 },
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    plans: [
      { id: 'starter', name: 'Starter', monthlyCents: 2500 },
      { id: 'pro', name: 'Pro', monthlyCents: 10000 },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    plans: [
      { id: 'pro', name: 'Pro', monthlyCents: 725 },
      { id: 'business-plus', name: 'Business+', monthlyCents: 1500 },
    ],
  },
  {
    id: 'superhuman',
    name: 'Superhuman',
    plans: [
      { id: 'starter', name: 'Starter', monthlyCents: 2500 },
      { id: 'business', name: 'Business', monthlyCents: 3300 },
    ],
  },
];

export type ToolChoice = { selected: boolean; planId: string };

/** Yearly cost for the whole team. */
export type SavingsSummary = {
  toolsCents: number;
  macroCents: number;
};

/** Every tool selected, on its entry plan. */
export function initialChoices(): Record<SavingsToolId, ToolChoice> {
  return Object.fromEntries(
    SAVINGS_TOOLS.map((tool) => [
      tool.id,
      { selected: true, planId: tool.plans[0].id },
    ])
  ) as Record<SavingsToolId, ToolChoice>;
}

/** Yearly per-seat price of a tool's plan. */
export function annualPlanPrice(tool: SavingsTool, planId: string): number {
  const plan = tool.plans.find((item) => item.id === planId) ?? tool.plans[0];
  return plan.monthlyCents * 12;
}

/** A whole number of seats between 1 and `MAX_SEATS`, or null if unparseable. */
export function parseSeats(value: string): number | null {
  const seats = Number.parseInt(value, 10);
  if (!Number.isFinite(seats)) return null;
  return Math.min(MAX_SEATS, Math.max(1, seats));
}

/** Yearly cost of Macro's paid plan: $40 a seat for the first 5, then $80. */
export function macroAnnualCost(seats: number): number {
  const discounted = Math.min(seats, MACRO_DISCOUNTED_SEATS);
  const extra = seats - discounted;
  return (discounted * MACRO_SEAT_CENTS + extra * MACRO_EXTRA_SEAT_CENTS) * 12;
}

/** Yearly team cost of the selected tools and of Macro. */
export function summarizeSavings(
  choices: Record<SavingsToolId, ToolChoice>,
  seats: number
): SavingsSummary {
  const perSeatCents = SAVINGS_TOOLS.reduce((total, tool) => {
    const choice = choices[tool.id];
    return choice.selected
      ? total + annualPlanPrice(tool, choice.planId)
      : total;
  }, 0);
  return {
    toolsCents: perSeatCents * seats,
    macroCents: macroAnnualCost(seats),
  };
}

/** `$52.25`, or `$147` when there are no cents. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
