import { PLAN_ACTIVE_ROUTINES, PLAN_USAGE_LABELS } from '../../paywall/plans';

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
    shortValues: {
      free: 'Limited',
      premium: 'Standard',
      business: '3×',
      max: '10×',
    },
  },
  {
    feature: 'Connected email accounts',
    short: 'Inboxes',
    values: {
      free: 'Up to 2',
      premium: 'Unlimited',
      business: 'Unlimited',
      max: 'Unlimited',
    },
    shortValues: {
      free: '2',
      premium: 'Unlimited',
      business: 'Unlimited',
      max: 'Unlimited',
    },
  },
  {
    feature: 'Email branding',
    short: 'Watermark',
    values: {
      free: '“Sent with Macro”',
      premium: 'No watermark',
      business: 'No watermark',
      max: 'No watermark',
    },
    shortValues: {
      free: 'Yes',
      premium: 'None',
      business: 'None',
      max: 'None',
    },
  },
  {
    feature: 'AI models',
    short: 'AI models',
    values: {
      free: 'Gemini 4 Hydrogen',
      premium: 'All models',
      business: 'All models',
      max: 'All models',
    },
    shortValues: {
      free: 'Gemini',
      premium: 'All',
      business: 'All',
      max: 'All',
    },
  },
  {
    feature: 'Active routines',
    short: 'Routines',
    values: PLAN_ACTIVE_ROUTINES,
    shortValues: PLAN_ACTIVE_ROUTINES,
  },
  {
    feature: 'Storage',
    short: 'Storage',
    values: {
      free: '5 GB',
      premium: '100 GB',
      business: '500 GB',
      max: '1 TB',
    },
    shortValues: {
      free: '5 GB',
      premium: '100 GB',
      business: '500 GB',
      max: '1 TB',
    },
  },
  {
    feature: 'Calls, recording & transcription',
    short: 'Calls',
    values: {
      free: 'Not included',
      premium: 'Included',
      business: 'Included',
      max: 'Included',
    },
    shortValues: { free: '—', premium: '✓', business: '✓', max: '✓' },
  },
  {
    feature: 'SSO/SAML, signed DPA & IT reviews',
    short: 'SSO & DPA',
    values: {
      free: 'Not included',
      premium: 'Not included',
      business: 'Included',
      max: 'Included',
    },
    shortValues: { free: '—', premium: '—', business: '✓', max: '✓' },
  },
  {
    feature: 'Onboarding & support',
    short: 'Onboarding',
    values: {
      free: 'Self-serve',
      premium: 'Self-serve',
      business: 'White-glove',
      max: 'White-glove',
    },
    shortValues: {
      free: 'Self',
      premium: 'Self',
      business: 'Guided',
      max: 'Guided',
    },
  },
] as const;
