import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import FunnelIcon from '@phosphor/funnel-simple.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, Layer } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { TagDot } from './TagDot';
import {
  type EditableTag,
  TagEditorDialog,
  type TagEditorDialogMode,
} from './TagEditorDialog';
import { TagPicker } from './TagPicker';
import {
  buildTaggedItemsSplitContent,
  buildTaggedItemsSplitOptions,
} from './tagNavigation';
import type { ResolvedTag } from './useDocTags';
import { useDocTags } from './useDocTags';

const chipClass = cn(
  'inline-flex items-center gap-1.5 m-px min-w-0 max-w-[30ch]',
  'px-2 py-1 leading-tight rounded-full ring ring-edge-muted bg-surface',
  'text-ink-muted transition-colors hover:bg-hover hover:text-ink'
);

function TagChip(props: {
  tag: ResolvedTag;
  docTags: ReturnType<typeof useDocTags>;
  canEdit: boolean;
  onEdit: (tag: ResolvedTag) => void;
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
          <Show
            when={props.canEdit}
            fallback={
              <span class={cn(chipClass, 'cursor-default hover:bg-surface')}>
                <TagDot color={props.tag.color} />
                <span class="min-w-0 truncate">{props.tag.label}</span>
              </span>
            }
          >
            <TagPicker
              docTags={props.docTags}
              replaceTag={props.tag}
              triggerClass={chipClass}
              triggerLabel={`Change or select tag ${props.tag.label}`}
            >
              <TagDot color={props.tag.color} />
              <span class="min-w-0 truncate">{props.tag.label}</span>
            </TagPicker>
          </Show>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuItem
              icon={FunnelIcon}
              text="View all items with tag"
              onClick={viewTaggedItems}
            />
            <Show when={props.canEdit}>
              <MenuItem
                icon={PencilIcon}
                text="Edit tag"
                onClick={() => props.onEdit(props.tag)}
              />
              <MenuItem icon={XIcon} text="Remove tag" onClick={removeTag} />
            </Show>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Layer>
  );
}

function editableTagFromResolved(
  docTags: ReturnType<typeof useDocTags>,
  tag: ResolvedTag
): EditableTag | undefined {
  const set = docTags.tagSets().find((tagSet) => tagSet.scope === tag.scope);
  const option = set?.options.find(
    (candidate) => candidate.id === tag.optionId
  );
  if (!set?.definition || !option) return undefined;

  return {
    scope: tag.scope,
    propertyDefinitionId: set.definition.id,
    option,
  };
}

export function TagsRow(props: {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
  triggerVariant?: 'icon' | 'pill';
}) {
  const docTags = useDocTags(props.entityId, props.entityType);
  const triggerVariant = () => props.triggerVariant ?? 'icon';
  const hasTags = () => docTags.appliedTags().length > 0;
  const [editorMode, setEditorMode] = createSignal<TagEditorDialogMode | null>(
    null
  );

  const openEdit = (tag: ResolvedTag) => {
    const editable = editableTagFromResolved(docTags, tag);
    if (!editable) return;
    setEditorMode({ type: 'edit', tag: editable });
  };

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={docTags.appliedTags()}>
        {(tag) => (
          <TagChip
            tag={tag}
            docTags={docTags}
            canEdit={props.canEdit}
            onEdit={openEdit}
          />
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
          <Match when={triggerVariant() === 'pill' && !hasTags()}>
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
                'inline-flex items-center justify-center rounded-full px-1 py-1 leading-tight',
                'm-px ring ring-edge-muted bg-surface text-ink-muted',
                'transition-colors hover:bg-hover hover:text-ink'
              )}
              triggerLabel="Add tags"
            >
              <PlusIcon class="size-3" />
            </TagPicker>
          </Match>
        </Switch>
      </Show>
      <TagEditorDialog
        open={editorMode() !== null}
        mode={editorMode()}
        teamAvailable={Boolean(
          docTags.tagSets().some((set) => set.scope === 'team')
        )}
        onClose={() => setEditorMode(null)}
      />
    </div>
  );
}
