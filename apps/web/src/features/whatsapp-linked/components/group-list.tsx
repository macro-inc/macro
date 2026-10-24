import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Avatar, Button, cn, Item } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  groupInitials,
  unsupportedReason,
  type WhatsAppGroup,
} from '../core/group';

function GroupRow(props: {
  group: WhatsAppGroup;
  children: JSX.Element;
  error?: string;
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
        <Item.Metadata>
          {props.group.memberCount === 1
            ? '1 member'
            : `${props.group.memberCount} members`}
        </Item.Metadata>
        <Show when={props.error}>
          <p role="alert" class="text-xs text-failure-ink">
            {props.error}
          </p>
        </Show>
      </Item.Content>
      <Item.Actions>{props.children}</Item.Actions>
    </Item>
  );
}

/**
 * Groups the viewer can bring into Macro with one click, and ones someone
 * already shared with them.
 */
export function AddableGroupList(props: {
  groups: WhatsAppGroup[];
  canAdd: boolean;
  /** JIDs whose add is in flight. */
  adding: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  onAdd: (group: WhatsAppGroup) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  return (
    <ul class="flex flex-col gap-1" aria-label="Groups to add to Macro">
      <For
        each={props.groups}
        fallback={
          <li class="px-3 py-2 text-sm text-ink-muted">
            Every WhatsApp group you can add is already in Macro.
          </li>
        }
      >
        {(group) => (
          <li>
            <GroupRow group={group} error={props.errors[group.jid]}>
              <Switch
                fallback={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!props.canAdd || props.adding.has(group.jid)}
                    tooltip={
                      props.canAdd
                        ? undefined
                        : 'Adding WhatsApp groups is turned off'
                    }
                    onClick={() => props.onAdd(group)}
                  >
                    <PlusIcon />
                    {props.adding.has(group.jid) ? 'Adding…' : 'Add to Macro'}
                  </Button>
                }
              >
                <Match
                  when={
                    group.inMacro?.kind === 'shared' ? group.inMacro : undefined
                  }
                >
                  {(shared) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onOpenGroup(shared().groupId)}
                    >
                      <span class="text-ink-muted">
                        Shared with you by {shared().ownerName} ·
                      </span>
                      <span class="font-medium text-ink">Open</span>
                    </Button>
                  )}
                </Match>
              </Switch>
            </GroupRow>
          </li>
        )}
      </For>
    </ul>
  );
}

/** Groups Macro can't hold, folded away with the reason for each. */
export function UnsupportedGroupList(props: { groups: WhatsAppGroup[] }) {
  const [open, setOpen] = createSignal(false);
  return (
    <section class="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open()}
        class="flex items-center gap-1 px-3 pb-1 text-left text-xs font-medium text-ink-subtle hover:text-ink"
        onClick={() => setOpen((value) => !value)}
      >
        Can't be added ({props.groups.length})
        <CaretDownIcon
          aria-hidden="true"
          class={cn('size-2.5 transition-transform', !open() && '-rotate-90')}
        />
      </button>
      <CollapseTransition open={open()}>
        <ul class="flex flex-col gap-1" aria-label="Can't be added">
          <For each={props.groups}>
            {(group) => (
              <li>
                <GroupRow group={group}>
                  <span class="text-xs text-ink-subtle">
                    {group.unsupported
                      ? unsupportedReason(group.unsupported)
                      : undefined}
                  </span>
                </GroupRow>
              </li>
            )}
          </For>
        </ul>
      </CollapseTransition>
    </section>
  );
}
