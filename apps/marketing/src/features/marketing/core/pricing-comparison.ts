import {
  macroAnnualCost,
  SAVINGS_TOOLS,
  type SavingsPlan,
  type SavingsToolId,
} from './savings-calculator';

export type ComparisonTool = {
  id: string;
  name: string;
  plan: SavingsPlan;
  source: string;
};

// Reuse the tiered catalog used by /tour; /pricing shows just one relevant plan.
function comparisonTool(
  id: SavingsToolId,
  planId: string,
  source: string
): ComparisonTool {
  const tool = SAVINGS_TOOLS.find((item) => item.id === id);
  const plan = tool?.plans.find((item) => item.id === planId);
  if (!tool || !plan)
    throw new Error(`Unknown comparison plan: ${id}/${planId}`);
  return { id, name: tool.name, plan, source };
}

/** Published USD seat rates. Annual billing except where noted in the UI. */
export const COMPARISON_GROUPS: readonly {
  name: string;
  tools: readonly ComparisonTool[];
}[] = [
  {
    name: 'Email & team chat',
    tools: [
      comparisonTool(
        'superhuman',
        'business',
        'https://superhuman.com/plans/mail'
      ),
      comparisonTool('slack', 'business-plus', 'https://slack.com/pricing'),
    ],
  },
  {
    name: 'Docs, sheets & projects',
    tools: [
      comparisonTool('notion', 'business', 'https://www.notion.com/pricing'),
      {
        id: 'airtable',
        name: 'Airtable',
        plan: { id: 'team', name: 'Team', monthlyCents: 2000 },
        source: 'https://airtable.com/pricing',
      },
      comparisonTool('linear', 'business', 'https://linear.app/pricing'),
      comparisonTool(
        'jira',
        'premium',
        'https://www.atlassian.com/software/jira/pricing'
      ),
      comparisonTool('asana', 'advanced', 'https://asana.com/pricing'),
      comparisonTool('clickup', 'business', 'https://clickup.com/pricing'),
    ],
  },
  {
    name: 'CRM',
    tools: [
      comparisonTool(
        'hubspot',
        'professional',
        'https://www.hubspot.com/pricing/sales'
      ),
      comparisonTool(
        'salesforce',
        'pro',
        'https://www.salesforce.com/sales/pricing/'
      ),
    ],
  },
  {
    name: 'Calls, notes & scheduling',
    tools: [
      {
        id: 'zoom',
        name: 'Zoom',
        plan: { id: 'pro', name: 'Workplace Pro', monthlyCents: 1416 },
        source: 'https://zoom.us/pricing',
      },
      {
        id: 'otter',
        name: 'Otter',
        plan: { id: 'business', name: 'Business', monthlyCents: 1999 },
        source: 'https://otter.ai/pricing',
      },
      {
        id: 'calendly',
        name: 'Calendly',
        plan: { id: 'standard', name: 'Standard', monthlyCents: 1000 },
        source: 'https://calendly.com/pricing',
      },
    ],
  },
  {
    name: 'Files & PDFs',
    tools: [
      {
        id: 'dropbox',
        name: 'Dropbox',
        plan: { id: 'standard', name: 'Standard', monthlyCents: 1500 },
        source: 'https://www.dropbox.com/plans',
      },
      {
        id: 'acrobat',
        name: 'Adobe Acrobat',
        plan: { id: 'pro-teams', name: 'Pro for teams', monthlyCents: 2399 },
        source: 'https://www.adobe.com/acrobat/business/pricing/plans.html',
      },
    ],
  },
];

export const COMPARISON_TOOLS = COMPARISON_GROUPS.flatMap(
  (group) => group.tools
);
export const MORE_COMPARISON_TOOLS = [
  'airtable',
  'asana',
  'clickup',
  'zoom',
  'otter',
  'calendly',
  'dropbox',
  'acrobat',
];
export const DEFAULT_COMPARISON_TOOLS = [
  'superhuman',
  'slack',
  'notion',
  'linear',
];

export function summarizeComparison(
  selected: readonly string[],
  seats: number
) {
  const monthlySeatCents = COMPARISON_TOOLS.reduce(
    (total, tool) =>
      total + (selected.includes(tool.id) ? tool.plan.monthlyCents : 0),
    0
  );
  const toolsCents = monthlySeatCents * seats * 12;
  const macroCents = macroAnnualCost(seats);
  return {
    monthlySeatCents,
    toolsCents,
    macroCents,
    differenceCents: toolsCents - macroCents,
  };
}
