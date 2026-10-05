/** Feature comparison shown below the trial offer. */
export const PLAN_COMPARISON = [
  { feature: 'Connected email accounts', guest: 'Up to 2', pro: 'Unlimited' },
  {
    feature: 'Email branding',
    guest: '“Sent with Macro” footer',
    pro: 'No watermark',
  },
  { feature: 'AI models', guest: 'Haiku', pro: 'All models' },
  { feature: 'Storage', guest: '5 GB', pro: '1 TB' },
  {
    feature: 'Calls, recording & transcription',
    guest: 'Not included',
    pro: 'Included',
  },
] as const;
