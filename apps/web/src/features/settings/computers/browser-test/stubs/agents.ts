// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/queries/agents/agents';

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
