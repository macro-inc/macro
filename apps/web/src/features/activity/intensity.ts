export type ActivityIntensity = 0 | 1 | 2 | 3 | 4;

export function intensityLevel(count: number, max: number): ActivityIntensity {
  if (count <= 0 || max <= 0) return 0;
  return Math.ceil(Math.min(count / max, 1) * 4) as ActivityIntensity;
}

export const INTENSITY_CLASS: Record<ActivityIntensity, string> = {
  0: 'bg-activity-0',
  1: 'bg-activity-1',
  2: 'bg-activity-2',
  3: 'bg-activity-3',
  4: 'bg-activity-4',
};
