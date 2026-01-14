import { type ClassNameValue, twMerge } from 'tailwind-merge';
import { clsx } from 'clsx';

export const cn = (...args: ClassNameValue[]) => {
  return twMerge(clsx(args));
};
