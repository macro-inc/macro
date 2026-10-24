import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import type { GroupSummary } from '@app/features/whatsapp-group/core/group';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';

function UnreadCount(props: { count: number }) {
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
      <span
        class="min-w-0 flex-1 truncate"
        classList={{ 'font-medium text-ink': props.group.unreadCount > 0 }}
      >
        {props.group.name}
      </span>
      <Show when={!props.group.canSend}>
        <span
          class="shrink-0 text-xs text-ink-extra-muted"
          title="You can read this group. Your WhatsApp isn't in it, so you can't send."
        >
          Read-only
        </span>
      </Show>
      <UnreadCount count={props.group.unreadCount} />
    </ViewSidebar.Item>
  );
}

/** WhatsApp groups this viewer can read in Macro: their own and shared ones. */
export function InMacroSection(props: {
  groups: GroupSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  activeGroupId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenGroup: (groupId: string) => void;
  onRetry: () => void;
}) {
  const unread = () =>
    (props.groups ?? []).reduce((sum, group) => sum + group.unreadCount, 0);
  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger class="flex-1">
          <span class="min-w-0 truncate">In Macro</span>
          <CollapsibleSection.Indicator />
          <Show when={!props.open}>
            <UnreadCount count={unread()} />
          </Show>
        </CollapsibleSection.Trigger>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <Switch>
          <Match when={props.groups}>
            {(groups) => (
              <ViewSidebar.Nav aria-label="WhatsApp groups in Macro">
                <For
                  each={groups()}
                  fallback={
                    <p class="px-3 py-2 text-sm text-ink-extra-muted">
                      No WhatsApp groups in Macro yet
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
            <p role="status" class="px-3 py-2 text-sm text-ink-extra-muted">
              Loading groups…
            </p>
          </Match>
          <Match when={props.isError}>
            <div class="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted">
              <span role="alert">Couldn't load your groups.</span>
              <Button size="sm" variant="ghost" onClick={props.onRetry}>
                Try again
              </Button>
            </div>
          </Match>
        </Switch>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}
