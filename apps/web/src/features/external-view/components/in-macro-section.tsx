import { ViewSidebar } from '@app/components/view-shell';
import type { GroupSummary } from '@app/features/whatsapp-group/core/group';
import UserIcon from '@phosphor/user.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';

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

function GroupRow(props: {
  group: GroupSummary;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <ViewSidebar.Item
      active={props.active}
      title={props.group.name}
      onClick={props.onOpen}
    >
      <ViewSidebar.Icon>
        <Show
          when={props.group.kind === 'direct'}
          fallback={<UsersThreeIcon />}
        >
          <UserIcon />
        </Show>
      </ViewSidebar.Icon>
      <span
        class="min-w-0 flex-1 truncate"
        classList={{ 'font-medium text-ink': props.group.unreadCount > 0 }}
      >
        {props.group.name}
      </span>
      <Show when={!props.group.canSend}>
        <span
          class="shrink-0 text-xs text-ink-extra-muted"
          title={
            props.group.kind === 'direct'
              ? 'You can read this chat. Only its owner can reply.'
              : "You can read this group. Your WhatsApp isn't in it, so you can't send."
          }
        >
          Read-only
        </span>
      </Show>
      <UnreadCount count={props.group.unreadCount} />
    </ViewSidebar.Item>
  );
}

/**
 * WhatsApp groups this viewer can read in Macro, their own and shared ones,
 * as rows nested under WhatsApp in External's sidebar.
 */
export function InMacroGroups(props: {
  groups: GroupSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  activeGroupId: string | undefined;
  onOpenGroup: (groupId: string) => void;
  onRetry: () => void;
}) {
  return (
    <Switch>
      <Match when={props.groups}>
        {(groups) => (
          <ViewSidebar.Nav aria-label="WhatsApp chats in Macro">
            <For
              each={groups()}
              fallback={
                <p class="px-(--sidebar-item-inset) py-1.5 text-sm text-ink-extra-muted">
                  No chats added yet
                </p>
              }
            >
              {(group) => (
                <GroupRow
                  group={group}
                  active={group.id === props.activeGroupId}
                  onOpen={() => props.onOpenGroup(group.id)}
                />
              )}
            </For>
          </ViewSidebar.Nav>
        )}
      </Match>
      <Match when={props.isPending}>
        <p
          role="status"
          class="px-(--sidebar-item-inset) py-1.5 text-sm text-ink-extra-muted"
        >
          Loading chats…
        </p>
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
