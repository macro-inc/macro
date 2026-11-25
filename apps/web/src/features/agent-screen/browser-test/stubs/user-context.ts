import { ME } from './dm';

export * from '../../../../lib/core/context/user';

export function useUserId() {
  return () => ME;
}
