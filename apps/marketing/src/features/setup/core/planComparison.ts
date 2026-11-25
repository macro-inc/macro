/** Preview copy aligned with the app's plan definitions and paywall messages.
 * Email limits: authentication_service/api/link/gmail.rs; branding:
 * email-compose/core/constants.ts; active routines:
 * scheduled_action/src/domain/routine_limit.rs; other gates: PaywallState and
 * PaywallComponent.
 * Keep this local to the standalone website, which cannot import app modules. */
export const PLAN_COMPARISON = [
  { feature: 'Connected email accounts', guest: 'Up to 2', pro: 'Unlimited' },
  {
    feature: 'Email branding',
    guest: '“Sent with Macro” footer',
    pro: 'No watermark',
  },
  { feature: 'AI models', guest: 'Gemini Flash', pro: 'All models' },
  { feature: 'Active routines', guest: '10', pro: '1,000' },
  { feature: 'Storage', guest: '5 GB', pro: '100 GB' },
  {
    feature: 'Calls, recording & transcription',
    guest: 'Not included',
    pro: 'Included',
  },
] as const;
