import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EntityIcon } from '@core/component/EntityIcon';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { formatDistanceToNowStrict } from 'date-fns';
import { ErrorBoundary, For, Show, Suspense } from 'solid-js';

const DEFAULT_LIMIT = 3;

/** Chats only, most recently updated first. */
const RECENT_CHATS_ARGS: SoupItemsQueryArgs = {
  params: { sort_method: 'updated_at', limit: 10 },
  body: { ...QUERY_FILTERS_BASE, chat_filters: undefined },
};

/** The user's most recently updated AI chats, newest first. */
export function useRecentChatSessions(limit = DEFAULT_LIMIT) {
  const query = useSoupItemsQuery(() => RECENT_CHATS_ARGS);
  return () =>
    (query.data ?? [])
      .filter((entity) => entity.type === 'chat')
      .filter((chat) => chat.name)
      .slice(0, limit);
}

/**
 * The user's most recent AI chats, rendered as compact session rows. Used on
 * the new-chat empty screen in place of the home "Recommended" section.
 * Renders nothing when there are no sessions.
 */
export function RecentSessionsSection(props: { limit?: number }) {
  return (
    <ErrorBoundary fallback={() => null}>
      <Suspense fallback={null}>
        <RecentSessionsContent limit={props.limit} />
      </Suspense>
    </ErrorBoundary>
  );
}

function RecentSessionsContent(props: { limit?: number }) {
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
                class="group flex w-full items-center gap-3.5 rounded-xl border border-edge-muted bg-active px-4 py-3 text-left transition-colors hover:bg-hover"
                onClick={() => openChat(session.id)}
              >
                <EntityIcon targetType="chat" size="xs" />
                <span class="flex-1 truncate text-sm font-medium text-ink">
                  {session.name}
                </span>
                <Show when={session.updatedAt}>
                  {(updatedAt) => (
                    <span class="shrink-0 text-xs tabular-nums text-ink-extra-muted">
                      {formatDistanceToNowStrict(updatedAt(), {
                        addSuffix: true,
                      })}
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
