import { setAgentDmOpened } from './fixture-state';

/** Records the DM Chat with opens, in place of the real channel. */
export function useOpenAgentDm() {
  return {
    open: async (botId: string) => {
      setAgentDmOpened(botId);
    },
    pending: () => false,
  };
}
