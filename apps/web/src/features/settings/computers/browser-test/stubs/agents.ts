import { agents } from './fixture-state';

export function useAgentsQuery() {
  return {
    get isSuccess() {
      return true;
    },
    get data() {
      return agents();
    },
  };
}

export async function invalidateAgents() {}
