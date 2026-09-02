export type ActivityIntensity = 0 | 1 | 2 | 3 | 4;

export function intensityLevel(count: number, max: number): ActivityIntensity {
  if (count <= 0 || max <= 0) return 0;
  return Math.ceil(Math.min(count / max, 1) * 4) as ActivityIntensity;
}
