import CheckIcon from '@phosphor/check.svg';
import HashIcon from '@phosphor/hash.svg';
import LockIcon from '@phosphor/lock-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import UserIcon from '@phosphor/user.svg';
import { Badge, Button, cn } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { formatActivityDate } from '../../whatsapp-linked/core/chat';
import {
  cannotAddLabel,
  conversationMetadata,
  type SlackConversation,
} from '../core/conversation';

/**
 * One line per conversation, like WhatsApp's rows: icon, name, the other
 * organizations as badges, muted kind and last activity.
 */
function ConversationRow(props: {
  conversation: SlackConversation;
  actions?: JSX.Element;
  status?: JSX.Element;
  error?: string;
  pinActions?: boolean;
  /** Show the kind and last activity. */
  details: boolean;
}) {
  return (
    <div
      class="group/chat mx-2 flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2 text-sm not-touch:hover:bg-list-hover focus-within:bg-list-hover touch:min-h-11"
      data-slack-conversation={props.conversation.remoteId}
    >
      <span aria-hidden="true" class="flex size-4 shrink-0 text-ink-muted">
        <Switch fallback={<HashIcon class="size-4" />}>
          <Match when={props.conversation.kind === 'direct'}>
            <UserIcon class="size-4" />
          </Match>
          <Match when={props.conversation.isPrivate}>
            <LockIcon class="size-4" />
          </Match>
        </Switch>
      </span>
      <span class="ph-no-capture min-w-0 shrink truncate font-medium text-ink">
        {props.conversation.name}
      </span>
      <span class="flex min-w-0 shrink items-center gap-1 overflow-hidden">
        <For each={props.conversation.orgs}>
          {(org) => (
            <Badge variant="outline" size="xs" class="ph-no-capture">
              {org.name}
            </Badge>
          )}
        </For>
      </span>
      <Show when={props.details}>
        <span class="min-w-0 shrink-[2] truncate text-xs text-ink-extra-muted">
          {conversationMetadata(props.conversation)}
        </span>
      </Show>
      <span class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        <Show when={props.error}>
          <span role="alert" class="truncate text-xs text-failure-ink">
            {props.error}
          </span>
        </Show>
        <Show when={props.status}>
          <span class="flex items-center gap-1 truncate text-xs text-ink-extra-muted">
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
        <Show when={props.details && props.conversation.lastActivityAt}>
          {(at) => (
            <time
              dateTime={at()}
              class="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-ink-extra-muted"
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
 * One section's conversations: Added ones open, shared ones open with who
 * shared them, the rest add with one click.
 */
export function ConversationList(props: {
  label: string;
  conversations: SlackConversation[];
  /** Remote ids whose add is in flight. */
  adding: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onAdd: (conversation: SlackConversation) => void;
  onOpenChat: (chatId: string) => void;
  /** Show each conversation's kind and last activity. */
  details: boolean;
  /** Spell out "Add to Macro" next to its icon. */
  addLabel: boolean;
}) {
  return (
    <ul class="flex flex-col" aria-label={props.label}>
      <For each={props.conversations}>
        {(conversation) => {
          const own = () =>
            conversation.inMacro?.kind === 'own'
              ? conversation.inMacro
              : undefined;
          const shared = () =>
            conversation.inMacro?.kind === 'shared'
              ? conversation.inMacro
              : undefined;
          const adding = () => props.adding.has(conversation.remoteId);
          return (
            <li>
              <ConversationRow
                conversation={conversation}
                error={props.errors[conversation.remoteId]}
                pinActions={adding()}
                details={props.details}
                status={
                  <Switch>
                    <Match when={own()}>
                      <CheckIcon class="size-3.5" aria-hidden="true" />
                      Added
                    </Match>
                    <Match when={shared()}>
                      {(by) => <>Shared with you by {by().ownerName}</>}
                    </Match>
                  </Switch>
                }
                actions={
                  <Switch
                    fallback={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={adding() ? 'Adding…' : 'Add to Macro'}
                        disabled={adding()}
                        onClick={() => props.onAdd(conversation)}
                      >
                        <PlusIcon class="size-3.5" />
                        <Show when={props.addLabel}>
                          {adding() ? 'Adding…' : 'Add to Macro'}
                        </Show>
                      </Button>
                    }
                  >
                    <Match when={own() ?? shared()}>
                      {(chat) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Open ${conversation.name}`}
                          onClick={() => props.onOpenChat(chat().chatId)}
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

/** Conversations Macro can't hold, with the reason for each. */
export function UnsupportedConversationList(props: {
  conversations: SlackConversation[];
  /** Show each conversation's kind and last activity. */
  details: boolean;
}) {
  return (
    <ul class="flex flex-col" aria-label="Can't be added">
      <For each={props.conversations}>
        {(conversation) => (
          <li>
            <ConversationRow
              conversation={conversation}
              details={props.details}
              status={
                conversation.cannotAddReason
                  ? cannotAddLabel(conversation.cannotAddReason)
                  : undefined
              }
            />
          </li>
        )}
      </For>
    </ul>
  );
}
