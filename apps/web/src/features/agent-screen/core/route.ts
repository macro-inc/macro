/** The agent screen's route id, and its split content id. */
export const AGENT_SCREEN_ROUTE_ID = 'agent-screen';

/** Split content that opens an agent computer's screen. */
export function agentScreenContent(harnessId: string) {
  return {
    type: 'component' as const,
    id: AGENT_SCREEN_ROUTE_ID,
    params: { harnessId },
  };
}
