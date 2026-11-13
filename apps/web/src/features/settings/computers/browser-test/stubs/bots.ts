export function useUpdateBotMutation() {
  return { isPending: false, mutateAsync: async () => ({}) };
}

export function useBotsQuery() {
  return { isSuccess: true, data: [] };
}
