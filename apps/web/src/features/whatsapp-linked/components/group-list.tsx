import PlusIcon from '@phosphor/plus.svg';
import { Avatar, Button, Item } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { groupInitials, type WhatsAppGroup } from '../core/group';

function GroupRow(props: {
  group: WhatsAppGroup;
  canAdd: boolean;
  onAdd: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  return (
    <Item size="sm" class="px-3" data-whatsapp-group={props.group.jid}>
      <Avatar size="lg">
        <Avatar.Fallback class="text-sm font-medium">
          {groupInitials(props.group.name)}
        </Avatar.Fallback>
      </Avatar>
      <Item.Content class="min-w-0 gap-0">
        <Item.Title class="truncate">{props.group.name}</Item.Title>
        <Show when={props.group.unreadCount}>
          <span
            aria-label={`${props.group.unreadCount} unread messages`}
            class="rounded-full bg-accent px-2 text-xs text-panel"
          >
            {props.group.unreadCount}
          </span>
        </Show>
        <Item.Metadata>
          {props.group.memberCount === 1
            ? '1 member'
            : `${props.group.memberCount} members`}
        </Item.Metadata>
      </Item.Content>
      <Item.Actions>
        <Switch
          fallback={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!props.canAdd}
              onClick={props.onAdd}
            >
              <PlusIcon />
              Add to Macro
            </Button>
          }
        >
          <Match when={props.group.group}>
            {(group) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                tooltip={`Open ${group().name}`}
                onClick={() => props.onOpenGroup(group().id)}
              >
                <span class="text-ink-muted">In Macro →</span>
                <span class="flex items-center gap-0.5 font-medium text-ink">
                  {group().name}
                </span>
              </Button>
            )}
          </Match>
          <Match when={props.group.unsupported}>
            {(reason) => (
              <span class="text-xs text-ink-subtle">
                {reason() === 'community'
                  ? 'Communities not supported'
                  : 'Disappearing messages on'}
              </span>
            )}
          </Match>
        </Switch>
      </Item.Actions>
    </Item>
  );
}

/** The connected account's groups: adopted ones link to their group. */
export function GroupList(props: {
  groups: WhatsAppGroup[];
  canAdd: boolean;
  onAdd: (group: WhatsAppGroup) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  return (
    <ul class="flex flex-col gap-1" aria-label="Your WhatsApp groups">
      <For
        each={props.groups}
        fallback={
          <li class="px-3 py-2 text-sm text-ink-muted">
            This WhatsApp account isn't in any groups yet.
          </li>
        }
      >
        {(group) => (
          <li>
            <GroupRow
              group={group}
              canAdd={props.canAdd}
              onAdd={() => props.onAdd(group)}
              onOpenGroup={props.onOpenGroup}
            />
          </li>
        )}
      </For>
    </ul>
  );
}
