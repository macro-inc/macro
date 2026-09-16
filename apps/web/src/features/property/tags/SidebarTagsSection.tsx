import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import PlusIcon from '@phosphor/plus.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { TagTree } from './components/tag-tree';
import type { TagTreeNode } from './core/tag-tree';
import { TagEditorDialog } from './TagEditorDialog';
import { useTagTree } from './tag-sets-context';

export type SidebarTagsSectionProps = {
  /** Tag option ids the view is currently showing. */
  activeIds: readonly string[];
  /** Receives the selection a row click asks for; the host stores it. */
  onActiveIdsChange: (ids: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after a row is chosen, for hosts that show the section in a menu. */
  onNavigate?: () => void;
};

/**
 * A sidebar row is a destination, not a checkbox: choosing a tag shows that
 * tag alone, and choosing an active tag drops it from the selection.
 */
export function selectSidebarTag(
  activeIds: readonly string[],
  id: string
): string[] {
  if (activeIds.includes(id)) {
    return activeIds.filter((activeId) => activeId !== id);
  }
  return [id];
}

/**
 * The Tags section of a list view's sidebar: every tag the user can apply,
 * with the active ones highlighted, plus a shortcut to create one. Reads tag
 * sets from the nearest `TagSetsProvider`.
 */
export function SidebarTagsSection(props: SidebarTagsSectionProps) {
  const tree = useTagTree();
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const containsActiveTag = (node: TagTreeNode): boolean =>
    Boolean(node.tag && props.activeIds.includes(node.tag.id)) ||
    node.children.some(containsActiveTag);
  const isExpanded = (node: TagTreeNode): boolean =>
    expanded()[node.id] ?? node.children.some(containsActiveTag);
  const toggle = (node: TagTreeNode) => {
    const nextOpen = !isExpanded(node);
    setExpanded((current) => ({ ...current, [node.id]: nextOpen }));
  };
  const teamQuery = useCurrentTeamQuery();
  const [creating, setCreating] = createSignal(false);
  const teamAvailable = () =>
    teamQuery.isSuccess && Boolean(teamQuery.data?.team);

  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <div class="flex items-center gap-1">
        <CollapsibleSection.Trigger class="min-w-0 flex-1 text-xs">
          <span class="min-w-0 truncate">Tags</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          label="New tag"
          class="ml-auto mr-2 shrink-0 rounded-lg"
          onClick={() => setCreating(true)}
        >
          <PlusIcon class="size-3.5" />
        </Button>
      </div>
      <CollapsibleSection.Content>
        <Show
          when={tree().length > 0}
          fallback={
            <p class="px-3 py-2 text-sm text-ink-extra-muted">No tags yet</p>
          }
        >
          <ViewSidebar.Nav aria-label="Tags">
            <TagTree
              nodes={tree()}
              activeIds={props.activeIds}
              isExpanded={isExpanded}
              onToggle={toggle}
              onSelect={(id) => {
                props.onActiveIdsChange(selectSidebarTag(props.activeIds, id));
                props.onNavigate?.();
              }}
            />
          </ViewSidebar.Nav>
        </Show>
      </CollapsibleSection.Content>
      <TagEditorDialog
        open={creating()}
        mode={{ type: 'create', initialScope: 'user' }}
        teamAvailable={teamAvailable()}
        onClose={() => setCreating(false)}
      />
    </CollapsibleSection.Root>
  );
}
