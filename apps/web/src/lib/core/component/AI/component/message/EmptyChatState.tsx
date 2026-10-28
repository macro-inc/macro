import { ChatTipsSection } from '@app/features/home/chat-tips';
import { RecentSessionsSection } from '@app/features/home/home-recent-sessions';
import { createContext, type JSX, useContext } from 'solid-js';

/** Allows a host to replace the standalone chat onboarding surface. */
export const ChatEmptyStateContext = createContext<() => JSX.Element>();

/**
 * Empty state for a fresh chat, laid out identically to the home body:
 * recent sessions to jump back into, then the chat tips. Sized to its
 * content — forcing the parent height here would guarantee a scrollbar.
 */
export function EmptyChatState() {
  const renderEmptyState = useContext(ChatEmptyStateContext);
  if (renderEmptyState) return renderEmptyState();
  return (
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-6 pt-10 md:pt-16">
      <RecentSessionsSection />
      <ChatTipsSection />
    </div>
  );
}
