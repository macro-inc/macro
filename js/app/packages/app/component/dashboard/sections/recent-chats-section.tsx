import { ChatWithAgentIcon } from '@app/component/ChatWithAgentButton';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { formatRelativeDate } from '@core/util/time';
import CaretRightIcon from '@icon/regular/caret-right.svg';
import ChatIcon from '@icon/regular/chat-circle.svg';
import PlusIcon from '@icon/regular/plus.svg';
import { useHistoryQuery, type HistoryItem } from '@queries/history/history';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardItemRow,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const RECENT_CHATS_LIMIT = 5;

interface RecentChatsSectionProps {
  class?: string;
}

export function RecentChatsSection(props: RecentChatsSectionProps) {
  const { openWithSplit } = useSplitLayout();

  const handleSeeAll = () => {
    openWithSplit({ type: 'component', id: 'agents' });
  };

  return (
    <DashboardSection
      title="Recent Chats"
      icon={<ChatWithAgentIcon />}
      accent="chat"
      class={props.class}
      onSeeAll={handleSeeAll}
      fallback={<DashboardSectionLoading rows={3} />}
    >
      <RecentChatsContent />
    </DashboardSection>
  );
}

function RecentChatsContent() {
  const historyQuery = useHistoryQuery();
  const { openWithSplit } = useSplitLayout();

  const recentChats = createMemo(() => {
    const items = historyQuery.data ?? [];
    return items
      .filter((item): item is HistoryItem & { type: 'chat' } => item.type === 'chat')
      .slice(0, RECENT_CHATS_LIMIT);
  });

  const handleChatClick = (chatId: string) => {
    openWithSplit({
      type: 'chat',
      id: chatId,
    });
  };

  const handleNewChat = () => {
    openWithSplit({ type: 'chat', id: 'new' });
  };

  return (
    <Show
      when={recentChats().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<ChatIcon />}
          title="No recent chats"
          description="Start a conversation with AI"
          action={
            <Button variant="ghost" size="sm" onClick={handleNewChat} class="mt-2 gap-1">
              <PlusIcon class="size-3.5" />
              <span>New chat</span>
            </Button>
          }
        />
      }
    >
      <div class="flex flex-col -my-1 -mx-3 px-3">
        <For each={recentChats()}>
          {(chat) => (
            <button
              type="button"
              onClick={() => handleChatClick(chat.id)}
              class="flex items-center gap-3 py-2.5 px-3 w-full text-left hover:bg-ink/5 rounded-lg transition-colors"
            >
              <div class="size-5 flex items-center justify-center shrink-0 text-chat">
                <ChatWithAgentIcon />
              </div>
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <div class="text-sm text-ink truncate font-medium">
                  {chat.name || 'Untitled Chat'}
                </div>
                <Show when={chat.updatedAt}>
                  <div class="text-xs text-ink-extra-muted">
                    {formatRelativeDate(chat.updatedAt!)}
                  </div>
                </Show>
              </div>
              <CaretRightIcon class="size-4 text-ink-extra-muted shrink-0" />
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
