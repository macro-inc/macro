import { twMerge } from 'tailwind-merge';

// Local `clsx`-compatible types + implementation (so we don't depend on the external
// `clsx` package being installed).
export type ClassValue =
  | string
  | number
  | null
  | boolean
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

const clsx = (...args: ClassValue[]): string => {
  const out: string[] = [];

  const push = (v: ClassValue): void => {
    if (!v) return;
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) push(item);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, enabled] of Object.entries(v)) {
        if (enabled) out.push(k);
      }
    }
  };

  for (const a of args) push(a);
  return out.join(' ');
};

export const cn = (...args: ClassValue[]) => {
  return twMerge(clsx(...args));
};
