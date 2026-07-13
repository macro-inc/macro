import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FunnelIcon from '@phosphor/funnel-simple.svg';
import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, Layer } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { TagDot } from './TagDot';
import { TagPicker } from './TagPicker';
import {
  buildTaggedItemsSplitContent,
  buildTaggedItemsSplitOptions,
} from './tagNavigation';
import { useDocTags } from './useDocTags';
import type { ResolvedTag } from './useDocTags';

const chipClass = cn(
  'inline-flex items-center gap-1.5 m-px min-w-0 max-w-[30ch]',
  'px-2 py-1 leading-tight rounded-full ring ring-edge-muted bg-surface',
  'text-ink-muted transition-colors hover:bg-hover hover:text-ink'
);

function TagChip(props: {
  tag: ResolvedTag;
  docTags: ReturnType<typeof useDocTags>;
}) {
  const split = useSplitLayout();
  const panel = useSplitPanel();

  const viewTaggedItems = () => {
    split.openWithSplit(
      buildTaggedItemsSplitContent(props.tag),
      buildTaggedItemsSplitOptions({ handle: panel?.handle })
    );
  };

  const removeTag = () => {
    void props.docTags.removeTag(props.tag.scope, props.tag.optionId);
  };

  return (
    <Layer depth={2}>
      <ContextMenu>
        <ContextMenu.Trigger class="contents">
          <TagPicker
            docTags={props.docTags}
            replaceTag={props.tag}
            triggerClass={chipClass}
            triggerLabel={`Edit ${props.tag.label}`}
          >
            <TagDot color={props.tag.color} />
            <span class="min-w-0 truncate">{props.tag.label}</span>
            <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
          </TagPicker>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuItem
              icon={FunnelIcon}
              text="View all items with tag"
              onClick={viewTaggedItems}
            />
            <MenuItem icon={XIcon} text="Remove tag" onClick={removeTag} />
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Layer>
  );
}

export function TagsRow(props: {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  triggerVariant?: 'icon' | 'pill';
}) {
  const docTags = useDocTags(props.entityId, props.entityType);
  const triggerVariant = () => props.triggerVariant ?? 'icon';

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={docTags.appliedTags()}>
        {(tag) => (
          <TagChip tag={tag} docTags={docTags} />
        )}
      </For>
      <Show
        when={props.canEdit}
        fallback={
          <Show when={docTags.appliedTags().length === 0}>
            <span class="text-ink-extra-muted">No tags</span>
          </Show>
        }
      >
        <Switch>
          <Match when={triggerVariant() === 'pill'}>
            <TagPicker
              docTags={docTags}
              triggerClass={cn(
                'inline-flex items-center gap-1.5 m-px ring ring-edge-muted bg-surface',
                'px-2 py-1 leading-tight rounded-full text-ink-muted',
                'hover:bg-hover hover:text-ink transition-colors'
              )}
              triggerLabel="Add tags"
            >
              <PlusIcon class="size-3" />
              <span>Add tags</span>
            </TagPicker>
          </Match>
          <Match when={true}>
            <TagPicker
              docTags={docTags}
              triggerClass={cn(
                'inline-flex size-5 items-center justify-center rounded-full',
                'text-ink-muted transition-colors hover:bg-hover hover:text-ink'
              )}
              triggerLabel="Edit tags"
            >
              <PencilSimpleIcon class="size-3" />
            </TagPicker>
          </Match>
        </Switch>
      </Show>
    </div>
  );
}
