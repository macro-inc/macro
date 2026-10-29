import { CollapsibleSection } from '@app/components/view-shell';
import UsersFourIcon from '@phosphor/users-four.svg';
import { For, type JSX, Show } from 'solid-js';
import type { ChatCommunity, ConversationSections } from '../core/chat';

/**
 * A folding heading over a run of chats, on the same sidebar section Chat's
 * rail and the other view sidebars use.
 */
export function ConversationSection(props: {
  title: string;
  icon?: JSX.Element;
  /** Beside the heading, e.g. the unread count while folded. */
  trailing?: JSX.Element;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger class="flex-1">
          {props.icon}
          <span class="min-w-0 truncate">{props.title}</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        {props.trailing}
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>{props.children}</CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

/** Section ids, stable across sessions for the remembered open state. */
export const sectionId = {
  direct: 'direct',
  groups: 'groups',
  communities: 'communities',
  community: (community: ChatCommunity) => `community:${community.id}`,
};

/**
 * Direct messages, Groups, then Communities with one folding section per
 * community; empty sections don't show. `list` renders one section's items.
 */
export function ConversationSectionList<Item>(props: {
  sections: ConversationSections<Item>;
  isOpen: (sectionId: string) => boolean;
  onOpenChange: (sectionId: string, open: boolean) => void;
  list: (items: Item[], label: string) => JSX.Element;
  /** Beside a folded section's heading, e.g. its unread count. */
  folded?: (items: Item[]) => JSX.Element;
}) {
  const section = (id: string, title: string, items: Item[]) => (
    <Show when={items.length}>
      <ConversationSection
        title={title}
        open={props.isOpen(id)}
        onOpenChange={(open) => props.onOpenChange(id, open)}
        trailing={props.isOpen(id) ? undefined : props.folded?.(items)}
      >
        {props.list(items, title)}
      </ConversationSection>
    </Show>
  );
  return (
    <>
      {section(sectionId.direct, 'Direct messages', props.sections.direct)}
      {section(sectionId.groups, 'Groups', props.sections.groups)}
      <Show when={props.sections.communities.length}>
        <ConversationSection
          title="Communities"
          open={props.isOpen(sectionId.communities)}
          onOpenChange={(open) =>
            props.onOpenChange(sectionId.communities, open)
          }
          trailing={
            props.isOpen(sectionId.communities)
              ? undefined
              : props.folded?.(
                  props.sections.communities.flatMap(({ items }) => items)
                )
          }
        >
          <For each={props.sections.communities}>
            {({ community, items }) => (
              <div class="pl-(--sidebar-item-inset)">
                <ConversationSection
                  title={community.name}
                  icon={
                    <UsersFourIcon
                      aria-hidden="true"
                      class="size-3.5 shrink-0"
                    />
                  }
                  open={props.isOpen(sectionId.community(community))}
                  onOpenChange={(open) =>
                    props.onOpenChange(sectionId.community(community), open)
                  }
                  trailing={
                    props.isOpen(sectionId.community(community))
                      ? undefined
                      : props.folded?.(items)
                  }
                >
                  {props.list(items, community.name)}
                </ConversationSection>
              </div>
            )}
          </For>
        </ConversationSection>
      </Show>
    </>
  );
}
