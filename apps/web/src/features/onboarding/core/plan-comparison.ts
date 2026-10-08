import { PLAN_USAGE_LABELS } from '../../paywall/plans';

/** Feature comparison shown below the unchanged trial offer. */
export const PLAN_COMPARISON = [
  { feature: 'AI usage', values: PLAN_USAGE_LABELS },
  {
    feature: 'Connected email accounts',
    values: { free: 'Up to 2', premium: 'Unlimited', max: 'Unlimited' },
  },
  {
    feature: 'Email branding',
    values: {
      free: '“Sent with Macro” footer',
      premium: 'No watermark',
      max: 'No watermark',
    },
  },
  {
    feature: 'AI models',
    values: { free: 'Haiku', premium: 'All models', max: 'All models' },
  },
  {
    feature: 'Storage',
    values: { free: '5 GB', premium: '1 TB', max: '1 TB' },
  },
  {
    feature: 'Calls, recording & transcription',
    values: { free: 'Not included', premium: 'Included', max: 'Included' },
  },
] as const;
