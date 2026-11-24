/** The agent screen's route id, and its split content id. */
export const AGENT_SCREEN_ROUTE_ID = 'agent-screen';

/**
 * Split content that opens an agent computer's screen. `continueDriving`
 * marks a view that replaces one which was driving (a pop-out): it takes the
 * lease over once live.
 */
export function agentScreenContent(
  harnessId: string,
  options: { continueDriving?: boolean } = {}
) {
  return {
    type: 'component' as const,
    id: AGENT_SCREEN_ROUTE_ID,
    params: options.continueDriving
      ? { harnessId, continueDriving: 'true' }
      : { harnessId },
  };
}
