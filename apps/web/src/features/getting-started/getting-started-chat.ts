import type { GettingStartedState } from './getting-started-state';

/** Reopen each example's chat without sending its starter prompt again. */
export function createGettingStartedChatOpener(options: {
  state: Pick<GettingStartedState, 'chatIdForAction' | 'rememberChat'>;
  startChat: (prompt: string) => Promise<string | undefined>;
  openChat: (chatId: string) => void;
}) {
  const pending = new Set<string>();

  return async (actionId: string, prompt: string): Promise<boolean> => {
    if (pending.has(actionId)) return false;

    const existingChatId = options.state.chatIdForAction(actionId);
    if (existingChatId) {
      options.openChat(existingChatId);
      return true;
    }

    pending.add(actionId);
    try {
      let chatId: string | undefined;
      try {
        chatId = await options.startChat(prompt);
      } catch {
        return false;
      }
      if (!chatId) return false;
      options.state.rememberChat(actionId, chatId);
      options.openChat(chatId);
      return true;
    } finally {
      pending.delete(actionId);
    }
  };
}
