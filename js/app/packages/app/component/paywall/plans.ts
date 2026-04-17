export const PLANS = [
  {
    tier: 'haiku' as const,
    name: 'Level 1',
    price: 20,
    features: ['Haiku agent', '1,000 AI tool calls', '25 GB storage'],
    highlighted: false,
  },
  {
    tier: 'sonnet' as const,
    name: 'Level 2',
    price: 60,
    features: ['Sonnet agent', '5,000 AI tool calls', '100 GB storage'],
    highlighted: false,
  },
  {
    tier: 'opus' as const,
    name: 'Level 3',
    price: 120,
    features: ['Opus agent', 'Unlimited AI tool calls', '1 TB storage'],
    highlighted: true,
  },
] as const;

export type PlanTier = (typeof PLANS)[number]['tier'];
export type Plan = (typeof PLANS)[number];
