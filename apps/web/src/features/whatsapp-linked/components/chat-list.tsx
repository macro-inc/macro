import { formatRelativeDate } from '@core/util/time';
import CaretDownIcon from '@phosphor/caret-down.svg';
import MegaphoneIcon from '@phosphor/megaphone-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import UserIcon from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Button, cn } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  cannotAddLabel,
  chatMetadata,
  communityTitle,
  type WhatsAppChat,
} from '../core/chat';

/** A list heading, on the same 16px rail as the rows' icons. */
export function ChatSectionHeading(props: { id: string; children: string }) {
  return (
    <h2
      id={props.id}
      class="px-4 pt-4 pb-1 text-xs font-semibold tracking-tight text-ink-extra-muted"
    >
      {props.children}
    </h2>
  );
}

/**
 * One line per chat, like Macro's other lists: icon, name, muted kind and
 * last activity. `actions` show on hover or focus (always on touch); `status`
 * stays visible.
 */
function ChatRow(props: {
  chat: WhatsAppChat;
  actions?: JSX.Element;
  status?: JSX.Element;
  error?: string;
  /** Keep the actions visible, e.g. while an add is in flight. */
  pinActions?: boolean;
}) {
  return (
    <div
      class="group/chat mx-2 flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2 text-sm hover:bg-list-hover focus-within:bg-list-hover touch:min-h-11"
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
        {communityTitle(props.chat.name, props.chat.community)}
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
              'flex items-center gap-1 opacity-0 group-hover/chat:opacity-100 group-focus-within/chat:opacity-100 touch:opacity-100',
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
              class="w-[8ch] shrink-0 text-right text-xs text-ink-extra-muted touch:hidden"
            >
              {formatRelativeDate(at())}
            </time>
          )}
        </Show>
      </span>
    </div>
  );
}

/** Chats this viewer already added; they also live in External's sidebar. */
export function InMacroChatList(props: {
  chats: WhatsAppChat[];
  onOpenGroup: (groupId: string) => void;
}) {
  return (
    <ul class="flex flex-col" aria-label="WhatsApp chats in Macro">
      <For each={props.chats}>
        {(chat) => (
          <li>
            <ChatRow
              chat={chat}
              actions={
                <Show
                  when={chat.inMacro?.kind === 'own' ? chat.inMacro : undefined}
                >
                  {(own) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onOpenGroup(own().groupId)}
                    >
                      Open
                    </Button>
                  )}
                </Show>
              }
            />
          </li>
        )}
      </For>
    </ul>
  );
}

/**
 * Chats the viewer can bring into Macro with one click, and ones someone
 * already shared with them.
 */
export function AddableChatList(props: {
  chats: WhatsAppChat[];
  canAdd: boolean;
  /** JIDs whose add is in flight. */
  adding: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  /** Shown when nothing is left to add. */
  empty: string;
  onAdd: (chat: WhatsAppChat) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  return (
    <ul class="flex flex-col" aria-label="Chats to add to Macro">
      <For
        each={props.chats}
        fallback={
          <li class="px-4 py-2 text-sm text-ink-extra-muted">{props.empty}</li>
        }
      >
        {(chat) => {
          const shared = () =>
            chat.inMacro?.kind === 'shared' ? chat.inMacro : undefined;
          return (
            <li>
              <ChatRow
                chat={chat}
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
                        variant="outline"
                        size="sm"
                        aria-label={
                          props.adding.has(chat.jid)
                            ? 'Adding…'
                            : 'Add to Macro'
                        }
                        disabled={!props.canAdd || props.adding.has(chat.jid)}
                        tooltip={
                          props.canAdd
                            ? undefined
                            : 'Adding WhatsApp chats is turned off'
                        }
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
                    <Match when={shared()}>
                      {(by) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Open ${chat.name}, shared with you by ${by().ownerName}`}
                          onClick={() => props.onOpenGroup(by().groupId)}
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
  const expanded = () => open() || props.forceOpen;
  return (
    <section class="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded()}
        class="flex items-center gap-1 px-4 pt-4 pb-1 text-left text-xs font-semibold tracking-tight text-ink-extra-muted hover:text-ink"
        onClick={() => setOpen((value) => !value)}
      >
        Can't be added ({props.chats.length})
        <CaretDownIcon
          aria-hidden="true"
          class={cn(
            'size-2.5 transition-transform',
            !expanded() && '-rotate-90'
          )}
        />
      </button>
      <CollapseTransition open={expanded()}>
        <ul class="flex flex-col" aria-label="Can't be added">
          <For each={props.chats}>
            {(chat) => (
              <li>
                <ChatRow chat={chat} status={cannotAddLabel(chat)} />
              </li>
            )}
          </For>
        </ul>
      </CollapseTransition>
    </section>
  );
}
