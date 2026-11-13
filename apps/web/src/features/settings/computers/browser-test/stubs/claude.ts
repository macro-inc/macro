export function useClaudeModeQuery() {
  return { isSuccess: false, data: undefined };
}

export function useClaudeSignOutMutation() {
  return { isPending: false, mutateAsync: async () => ({}) };
}

export function useClaudeSignInMutation() {
  return {
    isPending: false,
    mutateAsync: async () => ({ url: 'https://claude.ai/oauth/authorize' }),
  };
}

export function useClaudeCompleteMutation() {
  return { isPending: false, mutateAsync: async () => ({ signedIn: true }) };
}
