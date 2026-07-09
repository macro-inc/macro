import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EntityIcon } from '@core/component/EntityIcon';
import type { DateValue } from '@core/util/date';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { createMemo, For, Show } from 'solid-js';
import { ROW } from './home-rows';

const DEFAULT_LIMIT = 3;

/** Chats only, most recently updated first. */
const RECENT_CHATS_ARGS: SoupItemsQueryArgs = {
  params: { sort_method: 'updated_at', limit: 10 },
  body: { ...QUERY_FILTERS_BASE, chat_filters: undefined },
};

/** Compact "22h" / "2w" style age, like a terminal session list. */
function timeAgo(value: DateValue): string {
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** The user's most recently updated AI chats, newest first. */
export function useRecentChatSessions(limit = DEFAULT_LIMIT) {
  const query = useSoupItemsQuery(() => RECENT_CHATS_ARGS);
  return createMemo(() =>
    (query.data ?? [])
      .filter((entity) => entity.type === 'chat')
      .filter((chat) => chat.name)
      .slice(0, limit)
  );
}

/**
 * The user's most recent AI chats, rendered as compact session rows. Used on
 * the new-chat empty screen in place of the home "Recommended" section.
 * Renders nothing when there are no sessions.
 */
export function RecentSessionsSection(props: { limit?: number }) {
  const sessions = useRecentChatSessions(props.limit);
  const splitPanel = useSplitPanel();

  const openChat = (id: string) => {
    if (splitPanel) {
      splitPanel.handle.replace({ next: { type: 'chat', id } });
    } else {
      globalSplitManager()?.openWithSplit(
        { type: 'chat', id },
        { activate: true }
      );
    }
  };

  return (
    <Show when={sessions().length > 0}>
      <section>
        <div class="mb-2 flex items-center px-1">
          <span class="text-sm text-ink-muted">Recent sessions</span>
        </div>
        <div class="flex flex-col gap-2">
          <For each={sessions()}>
            {(session) => (
              <button
                type="button"
                class={ROW}
                onClick={() => openChat(session.id)}
              >
                <EntityIcon targetType="chat" size="xs" />
                <span class="flex-1 truncate text-sm font-medium text-ink">
                  {session.name}
                </span>
                <Show when={session.updatedAt}>
                  {(updatedAt) => (
                    <span class="shrink-0 text-xs tabular-nums text-ink-extra-muted">
                      {timeAgo(updatedAt())}
                    </span>
                  )}
                </Show>
                <ChevronRightIcon class="size-4 shrink-0 text-ink-extra-muted" />
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
