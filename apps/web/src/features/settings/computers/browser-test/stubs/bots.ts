// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/queries/bots/bots';
export function useUpdateBotMutation() {
  return { isPending: false, mutateAsync: async () => ({}) };
}

export function useBotsQuery() {
  return { isSuccess: true, data: [] };
}
