import MegaphoneIcon from '@phosphor/megaphone-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import UserIcon from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Button, cn } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  cannotAddLabel,
  chatMetadata,
  communityTitle,
  formatActivityDate,
  nameInCommunity,
  type WhatsAppChat,
} from '../core/chat';
import { ConversationSection } from './conversation-sections';

/**
 * One line per chat, like Macro's other lists: icon, name, muted kind and
 * last activity. `actions` show on hover or focus (always on touch); `status`
 * stays visible.
 */
function ChatRow(props: {
  chat: WhatsAppChat;
  /** Under its community's heading a group goes by its own name. */
  inCommunity?: boolean;
  actions?: JSX.Element;
  status?: JSX.Element;
  error?: string;
  /** Keep the actions visible, e.g. while an add is in flight. */
  pinActions?: boolean;
}) {
  return (
    <div
      class="group/chat mx-2 flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2 text-sm not-touch:hover:bg-list-hover focus-within:bg-list-hover touch:min-h-11"
      data-whatsapp-chat={props.chat.jid}
      data-whatsapp-chat-kind={props.chat.kind}
    >
      <span aria-hidden="true" class="flex size-4 shrink-0 text-ink-muted">
        <Switch fallback={<UsersThreeIcon class="size-4" />}>
          <Match when={props.chat.kind === 'direct'}>
            <UserIcon class="size-4" />
          </Match>
          <Match when={props.chat.community?.announcements}>
            <MegaphoneIcon class="size-4" />
          </Match>
        </Switch>
      </span>
      <span class="ph-no-capture min-w-0 shrink truncate font-medium text-ink">
        {props.inCommunity
          ? nameInCommunity(props.chat)
          : communityTitle(props.chat.name, props.chat.community)}
      </span>
      <span class="min-w-0 shrink-[2] truncate text-xs text-ink-extra-muted">
        {chatMetadata(props.chat)}
      </span>
      <span class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        <Show when={props.error}>
          <span role="alert" class="truncate text-xs text-failure-ink">
            {props.error}
          </span>
        </Show>
        <Show when={props.status}>
          <span class="truncate text-xs text-ink-extra-muted">
            {props.status}
          </span>
        </Show>
        <Show when={props.actions}>
          <span
            class={cn(
              'flex items-center gap-1 opacity-0 not-touch:group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 touch:opacity-100',
              (props.pinActions || props.error) && 'opacity-100'
            )}
          >
            {props.actions}
          </span>
        </Show>
        <Show when={props.chat.lastActivityAt}>
          {(at) => (
            <time
              dateTime={at()}
              class="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-ink-extra-muted touch:hidden"
            >
              {formatActivityDate(at())}
            </time>
          )}
        </Show>
      </span>
    </div>
  );
}

/**
 * One section's chats: ones to add with one click, ones someone shared with
 * the viewer, and (while searching) the viewer's own added ones, each with
 * the action that fits.
 */
export function ChatList(props: {
  label: string;
  chats: WhatsAppChat[];
  inCommunity?: boolean;
  /** JIDs whose add is in flight. */
  adding: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onAdd: (chat: WhatsAppChat) => void;
  onOpenChat: (chatId: string) => void;
}) {
  return (
    <ul class="flex flex-col" aria-label={props.label}>
      <For each={props.chats}>
        {(chat) => {
          const shared = () =>
            chat.inMacro?.kind === 'shared' ? chat.inMacro : undefined;
          const own = () =>
            chat.inMacro?.kind === 'own' ? chat.inMacro : undefined;
          return (
            <li>
              <ChatRow
                chat={chat}
                inCommunity={props.inCommunity}
                error={props.errors[chat.jid]}
                pinActions={props.adding.has(chat.jid)}
                status={
                  <Show when={shared()}>
                    {(by) => <>Shared with you by {by().ownerName}</>}
                  </Show>
                }
                actions={
                  <Switch
                    fallback={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={
                          props.adding.has(chat.jid)
                            ? 'Adding…'
                            : 'Add to Macro'
                        }
                        disabled={props.adding.has(chat.jid)}
                        onClick={() => props.onAdd(chat)}
                      >
                        <PlusIcon />
                        {/* Phones keep every row's action visible, so just the + there. */}
                        <span class="mobile:hidden">
                          {props.adding.has(chat.jid)
                            ? 'Adding…'
                            : 'Add to Macro'}
                        </span>
                      </Button>
                    }
                  >
                    <Match when={own()}>
                      {(mine) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => props.onOpenChat(mine().chatId)}
                        >
                          Open
                        </Button>
                      )}
                    </Match>
                    <Match when={shared()}>
                      {(by) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Open ${chat.name}, shared with you by ${by().ownerName}`}
                          onClick={() => props.onOpenChat(by().chatId)}
                        >
                          Open
                        </Button>
                      )}
                    </Match>
                  </Switch>
                }
              />
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/** Chats Macro can't hold yet, folded away with the reason for each. */
export function UnsupportedChatList(props: {
  chats: WhatsAppChat[];
  /** Searching unfolds the list so matches show. */
  forceOpen: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="px-2 pt-3">
      <ConversationSection
        title={`Can't be added (${props.chats.length})`}
        open={open() || props.forceOpen}
        onOpenChange={setOpen}
      >
        <ul class="flex flex-col" aria-label="Can't be added">
          <For each={props.chats}>
            {(chat) => (
              <li>
                <ChatRow chat={chat} status={cannotAddLabel(chat)} />
              </li>
            )}
          </For>
        </ul>
      </ConversationSection>
    </div>
  );
}
