import type { NetworkDelay } from './types';

export const slowFirst: NetworkDelay = (i) => {
  if (i === 0) return 3500;
  else return 15;
};
const _constantDelay: NetworkDelay = () => 15;
export const noDelay: NetworkDelay = () => 0;
const _smallDelay: NetworkDelay = () => 1;
