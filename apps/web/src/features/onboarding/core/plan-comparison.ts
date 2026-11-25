import { PLAN_USAGE_LABELS } from '../../paywall/plans';

/**
 * Feature comparison shown below the unchanged trial offer. `short` and
 * `shortValues` are the phone copy: four columns at 390px leave each cell about
 * eight characters per line, so the full copy wraps into ragged rows there.
 */
export const PLAN_COMPARISON = [
  {
    feature: 'AI usage',
    short: 'AI usage',
    values: PLAN_USAGE_LABELS,
    shortValues: { free: 'Limited', premium: 'Standard', max: '10×' },
  },
  {
    feature: 'Connected email accounts',
    short: 'Inboxes',
    values: { free: 'Up to 2', premium: 'Unlimited', max: 'Unlimited' },
    shortValues: { free: '2', premium: 'Unlimited', max: 'Unlimited' },
  },
  {
    feature: 'Email branding',
    short: 'Watermark',
    values: {
      free: '“Sent with Macro”',
      premium: 'No watermark',
      max: 'No watermark',
    },
    shortValues: { free: 'Yes', premium: 'None', max: 'None' },
  },
  {
    feature: 'AI models',
    short: 'AI models',
    values: { free: 'Gemini Flash', premium: 'All models', max: 'All models' },
    shortValues: { free: 'Gemini', premium: 'All', max: 'All' },
  },
  {
    feature: 'Storage',
    short: 'Storage',
    values: { free: '5 GB', premium: '100 GB', max: '1 TB' },
    shortValues: { free: '5 GB', premium: '100 GB', max: '1 TB' },
  },
  {
    feature: 'Calls, recording & transcription',
    short: 'Calls',
    values: { free: 'Not included', premium: 'Included', max: 'Included' },
    shortValues: { free: '—', premium: '✓', max: '✓' },
  },
] as const;
