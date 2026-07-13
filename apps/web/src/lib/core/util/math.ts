export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function sumArray(arr: number[]): number {
  return arr.reduce((acc, val) => acc + val, 0);
}
