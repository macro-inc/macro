import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TagIcon from '@icon/system/regular/tag-simple.svg';
import XIcon from '@icon/system/regular/x.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Badge, buttonClasses, Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { TagDot } from './TagDot';
import {
  type EditableTag,
  TagEditorDialog,
  type TagEditorDialogMode,
} from './TagEditorDialog';
import { TagPicker } from './TagPicker';
import { TagPill } from './TagPill';
import {
  buildTaggedItemsSplitContent,
  buildTaggedItemsSplitOptions,
} from './tagNavigation';
import type { ResolvedTag } from './useDocTags';
import { useDocTags } from './useDocTags';

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
    fireAndForget(
      props.docTags.removeTag(props.tag.scope, props.tag.optionId),
      'property-tags'
    );
  };

  return (
    <Layer depth={2}>
      <ContextMenu>
        <ContextMenu.Trigger class="contents">
          <Show
            when={props.canEdit}
            fallback={
              <Badge
                variant="outline"
                size="sm"
                class="m-px min-w-0 max-w-[30ch] gap-1.5 cursor-default"
              >
                <TagDot color={props.tag.color} />
                <span class="min-w-0 truncate">{props.tag.label}</span>
              </Badge>
            }
          >
            <TagPill
              tag={props.tag}
              docTags={props.docTags}
              replaceTag={props.tag}
              class="m-px max-w-[30ch] gap-1.5"
            />
          </Show>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="text-xs text-ink-muted">
            <MenuItem
              icon={FunnelIcon}
              text={t('entityActions.viewItemsWithTag')}
              onClick={viewTaggedItems}
            />
            <Show when={props.canEdit}>
              <MenuItem
                icon={PencilIcon}
                text={t('entityActions.editTag')}
                onClick={() => props.onEdit(props.tag)}
              />
              <MenuItem
                icon={XIcon}
                text={t('entityActions.removeTag')}
                onClick={removeTag}
              />
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
      <Show
        when={triggerVariant() === 'pill' && !hasTags()}
        fallback={
          <>
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
                <Show when={!hasTags()}>
                  <span class="text-ink-extra-muted">No tags</span>
                </Show>
              }
            >
              <TagPicker
                docTags={docTags}
                triggerClass={buttonClasses({
                  variant: 'secondary',
                  size: 'icon-xs',
                  class: 'm-px',
                })}
                triggerLabel={t('common.addTags')}
              >
                <PlusIcon class="size-3" />
              </TagPicker>
            </Show>
          </>
        }
      >
        <Show
          when={props.canEdit}
          fallback={
            <span class="text-xs text-ink-muted">{t('common.emptyTags')}</span>
          }
        >
          <TagPicker
            docTags={docTags}
            triggerClass={buttonClasses({
              variant: 'outline',
              size: 'xs',
            })}
            triggerLabel={t('common.addTags')}
          >
            <TagIcon class="size-4" />
            {t('common.addTags')}
          </TagPicker>
        </Show>
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
