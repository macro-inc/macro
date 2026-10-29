import { ViewSidebar } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import UserIcon from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Button, Tooltip } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { ChatSummary } from '../../external-chat/core/chat';
import { providerIdentity } from '../../external-chat/providers/identity';
import { ConversationSectionList } from '../../whatsapp-linked/components/conversation-sections';
import {
  conversationSections,
  nameInCommunity,
} from '../../whatsapp-linked/core/chat';

function readOnlyReason(chat: ChatSummary): string {
  return chat.kind === 'direct'
    ? 'You can read this chat. Only its owner can reply.'
    : `You can read this group. Your ${providerIdentity(chat.provider).label} isn't in it, so you can't send.`;
}

export function UnreadCount(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span
        aria-label={`${props.count} unread messages`}
        class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast"
      >
        {props.count}
      </span>
    </Show>
  );
}

function ChatRow(props: {
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const name = () =>
    props.chat.community ? nameInCommunity(props.chat) : props.chat.name;
  return (
    <ViewSidebar.Item
      active={props.active}
      title={name()}
      onClick={props.onOpen}
    >
      <ViewSidebar.Icon>
        <Show when={props.chat.kind === 'direct'} fallback={<UsersThreeIcon />}>
          <UserIcon />
        </Show>
      </ViewSidebar.Icon>
      <span
        class="min-w-0 flex-1 truncate"
        classList={{ 'font-medium text-ink': props.chat.unreadCount > 0 }}
      >
        {name()}
      </span>
      <Show when={!props.chat.canSend}>
        <Tooltip label={readOnlyReason(props.chat)} as="span" class="shrink-0">
          <span class="text-xs text-ink-extra-muted">
            Read-only
            <span class="sr-only">: {readOnlyReason(props.chat)}</span>
          </span>
        </Tooltip>
      </Show>
      <UnreadCount count={props.chat.unreadCount} />
    </ViewSidebar.Item>
  );
}

/**
 * One provider's chats this viewer can read in Macro, their own and shared
 * ones, nested under the provider in External's sidebar: direct messages,
 * groups, then each community's groups, like Chat's rail. Folded sections
 * show their unread count.
 */
export function InMacroChats(props: {
  /** The provider's name: "WhatsApp chats in Macro". */
  label: string;
  chats: ChatSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  activeChatId: string | undefined;
  isOpen: (sectionId: string) => boolean;
  onOpenChange: (sectionId: string, open: boolean) => void;
  onOpenChat: (chatId: string) => void;
  onRetry: () => void;
}) {
  return (
    <Switch>
      <Match when={props.chats}>
        {(chats) => (
          <Show
            when={chats().length}
            fallback={
              <p class="px-(--sidebar-item-inset) py-1.5 text-sm text-ink-extra-muted">
                No chats added yet
              </p>
            }
          >
            <div
              role="navigation"
              aria-label={`${props.label} chats in Macro`}
              class="flex flex-col"
            >
              <ConversationSectionList
                sections={conversationSections(chats())}
                isOpen={props.isOpen}
                onOpenChange={props.onOpenChange}
                folded={(items) => (
                  <UnreadCount
                    count={items.reduce(
                      (sum, chat) => sum + chat.unreadCount,
                      0
                    )}
                  />
                )}
                list={(items, label) => (
                  <ViewSidebar.Nav aria-label={label}>
                    <For each={items}>
                      {(chat) => (
                        <ChatRow
                          chat={chat}
                          active={chat.id === props.activeChatId}
                          onOpen={() => props.onOpenChat(chat.id)}
                        />
                      )}
                    </For>
                  </ViewSidebar.Nav>
                )}
              />
            </div>
          </Show>
        )}
      </Match>
      <Match when={props.isPending}>
        <ViewSkeleton.Rows label="Loading chats" count={3} />
      </Match>
      <Match when={props.isError}>
        <div class="flex items-center gap-2 px-(--sidebar-item-inset) py-1.5 text-sm text-ink-muted">
          <span role="alert">Couldn't load your chats.</span>
          <Button size="sm" variant="ghost" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      </Match>
    </Switch>
  );
}
