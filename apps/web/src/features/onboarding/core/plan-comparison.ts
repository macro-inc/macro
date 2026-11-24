import { PLAN_USAGE_LABELS } from '../../paywall/plans';

/** Feature comparison shown below the unchanged trial offer. */
export const PLAN_COMPARISON = [
  { feature: 'AI usage', values: PLAN_USAGE_LABELS },
  {
    feature: 'Connected email accounts',
    values: {
      free: 'Up to 2',
      premium: 'Unlimited',
      business: 'Unlimited',
      max: 'Unlimited',
    },
  },
  {
    feature: 'Email branding',
    values: {
      free: '“Sent with Macro”',
      premium: 'No watermark',
      business: 'No watermark',
      max: 'No watermark',
    },
  },
  {
    feature: 'AI models',
    values: {
      free: 'Gemini Flash',
      premium: 'All models',
      business: 'All models',
      max: 'All models',
    },
  },
  {
    feature: 'Storage',
    values: { free: '5 GB', premium: '100 GB', business: '500 GB', max: '1 TB' },
  },
  {
    feature: 'Calls, recording & transcription',
    values: {
      free: 'Not included',
      premium: 'Included',
      business: 'Included',
      max: 'Included',
    },
  },
  {
    feature: 'SSO/SAML, signed DPA & IT reviews',
    values: {
      free: 'Not included',
      premium: 'Not included',
      business: 'Included',
      max: 'Included',
    },
  },
  {
    feature: 'Onboarding & support',
    values: {
      free: 'Self-serve',
      premium: 'Self-serve',
      business: 'White-glove',
      max: 'White-glove',
    },
  },
] as const;
