/** Preview copy aligned with the app's plan definitions and paywall messages.
 * Email limits: authentication_service/api/link/gmail.rs; branding:
 * email-compose/core/constants.ts; other gates: PaywallState and PaywallComponent.
 * Keep this local to the standalone website, which cannot import app modules. */
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
