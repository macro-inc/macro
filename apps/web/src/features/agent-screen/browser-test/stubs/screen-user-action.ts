// The agent's computer, without the harnesses query.
export * from '../../screen-user-action';

export function useAgentScreenHarnessId(userId: () => string | undefined) {
  return () => (userId() ? 'harness-1' : undefined);
}

export function useOpenAgentScreen() {
  return () => {};
}
