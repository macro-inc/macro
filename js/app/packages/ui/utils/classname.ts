import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

export const cn = (...args: ClassValue[]) => {
  return twMerge(clsx(args));
};
