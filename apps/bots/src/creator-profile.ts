import type { ComputerSize } from '@macro-inc/sdk/generated/auth';

export const sizes: readonly ComputerSize[] = ['standard', 'large', 'xl'];
export const sizeNames: Record<ComputerSize, string> = {
  standard: 'Standard',
  large: 'Large',
  xl: 'XL',
};

export const sampleResources = {
  standard: { vcpus: 4, memoryGb: 8, diskGb: 100 },
  large: { vcpus: 8, memoryGb: 16, diskGb: 200 },
  xl: { vcpus: 16, memoryGb: 32, diskGb: 400 },
} satisfies Record<
  ComputerSize,
  { vcpus: number; memoryGb: number; diskGb: number }
>;

export const intelligenceStops = {
  everyday: { label: 'Everyday', mix: [5, 20, 75] },
  advanced: { label: 'Advanced', mix: [20, 55, 25] },
  frontier: { label: 'Frontier', mix: [70, 20, 10] },
};

export const autonomyStops = {
  'check-in': {
    label: 'Check in',
    description: 'Asks before starting multi-step work.',
  },
  'take-initiative': {
    label: 'Take initiative',
    description: 'Handles routine work and checks in on big calls.',
  },
  'run-with-it': {
    label: 'Run with it',
    description: 'Runs multi-step work, then reports back.',
  },
};

export type Intelligence = keyof typeof intelligenceStops;
export type Autonomy = keyof typeof autonomyStops;
export const intelligenceChoices: readonly Intelligence[] = [
  'everyday',
  'advanced',
  'frontier',
];
export const autonomyChoices: readonly Autonomy[] = [
  'check-in',
  'take-initiative',
  'run-with-it',
];

export const sampleEstimates: Record<
  ComputerSize,
  Record<Intelligence, string>
> = {
  standard: {
    everyday: '$11–$14/hr',
    advanced: '$15–$18/hr',
    frontier: '$21–$26/hr',
  },
  large: {
    everyday: '$13–$16/hr',
    advanced: '$17–$21/hr',
    frontier: '$23–$29/hr',
  },
  xl: {
    everyday: '$16–$20/hr',
    advanced: '$20–$25/hr',
    frontier: '$26–$33/hr',
  },
};
