// Scoped under `entity` so `invalidateQueries({ queryKey: ['entity'] })`
// (fired from the move/rename mutations) refreshes it.
export const chatDataQueryKey = (chatId: string) =>
  ['entity', 'chatData', chatId] as const;
