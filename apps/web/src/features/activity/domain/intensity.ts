export type ActivityIntensity = 0 | 1 | 2 | 3 | 4;

export function intensityLevel(count: number, max: number): ActivityIntensity {
  if (count <= 0 || max <= 0) return 0;
  return Math.ceil(Math.min(count / max, 1) * 4) as ActivityIntensity;
}

export const INTENSITY_CLASS: Record<ActivityIntensity, string> = {
  0: 'bg-ink/10',
  1: 'bg-accent/25',
  2: 'bg-accent/45',
  3: 'bg-accent/70',
  4: 'bg-accent',
};
