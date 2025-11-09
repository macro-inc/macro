import type { NetworkDelay } from './types';

export const slowFirst: NetworkDelay = (i) => {
  if (i === 0) return 3500;
  else return 15;
};
export const constantDelay: NetworkDelay = () => 15;
export const noDelay: NetworkDelay = () => 0;
export const smallDelay: NetworkDelay = () => 1;
