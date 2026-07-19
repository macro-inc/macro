import CaretDownIcon from '@phosphor/caret-down.svg';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn, HoverCard, Layer } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { TagDot } from './TagDot';
import { type EditableTag, TagEditorDialog } from './TagEditorDialog';
import { TagPicker } from './TagPicker';
import { useDocTags, useSoupDocTags } from './useDocTags';
import { type ResolvedTag, useSoupResolvedTags } from './useSoupResolvedTags';

type DocTags = ReturnType<typeof useSoupDocTags>;
type CreateDocTags = () => DocTags;

const DEFAULT_MAX_VISIBLE = 3;
const MAX_OVERFLOW_DOTS = 3;

const chipClass = cn(
  'inline-flex items-center gap-1 shrink-0 max-w-[14ch]',
  'px-1.5 py-0.5 leading-tight rounded-full bg-surface text-ink-muted text-xs',
  'hover:text-ink'
);

function HoverTagRow(props: {
  tag: ResolvedTag;
  onFilter?: (id: string) => void;
  onEdit: (tag: ResolvedTag) => void;
}) {
  return (
    <div class="flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-ink hover:bg-hover">
      <Show
        when={props.onFilter}
        fallback={
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <TagDot color={props.tag.color} />
            <span class="min-w-0 truncate">{props.tag.label}</span>
          </span>
        }
      >
        {(onFilter) => (
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => onFilter()(props.tag.optionId)}
          >
            <TagDot color={props.tag.color} />
            <span class="min-w-0 truncate">{props.tag.label}</span>
          </button>
        )}
      </Show>
      <button
        type="button"
        aria-label={`Edit ${props.tag.label}`}
        class="flex size-5 shrink-0 items-center justify-center rounded text-ink-extra-muted hover:bg-hover hover:text-ink"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onEdit(props.tag);
        }}
      >
        <PencilIcon class="size-3.5" />
      </button>
    </div>
  );
}

function TagHoverContent(props: {
  tag: ResolvedTag;
  onFilterByTag?: (id: string) => void;
  onEdit: (tag: ResolvedTag) => void;
}) {
  return (
    <div class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink hover:bg-hover">
      <Show
        when={props.onFilterByTag}
        fallback={
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <TagDot color={props.tag.color} />
            <span class="min-w-0 truncate">{props.tag.label}</span>
          </span>
        }
      >
        {(onFilterByTag) => (
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap text-left"
            onClick={() => onFilterByTag()(props.tag.optionId)}
          >
            <FilterIcon class="size-3.5 shrink-0 text-ink-muted" />
            <span>
              Filter by <span class="font-medium">{props.tag.label}</span>
            </span>
          </button>
        )}
      </Show>
      <button
        type="button"
        aria-label={`Edit ${props.tag.label}`}
        class="flex size-5 shrink-0 items-center justify-center rounded text-ink-extra-muted hover:bg-hover hover:text-ink"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onEdit(props.tag);
        }}
      >
        <PencilIcon class="size-3.5" />
      </button>
    </div>
  );
}

function editableTagFromResolved(
  docTags: DocTags,
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

function RowTagEditorOwner(props: {
  tag: ResolvedTag;
  createDocTags: CreateDocTags;
  onClose: () => void;
}) {
  // Editing is an interaction boundary: initialize query/mutation-backed tag
  // state only after the user asks to edit this row's tag.
  const docTags = props.createDocTags();
  const editable = () => editableTagFromResolved(docTags, props.tag);

  return (
    <Show when={editable()}>
      {(tag) => (
        <TagEditorDialog
          open
          mode={{ type: 'edit', tag: tag() }}
          teamAvailable={Boolean(
            docTags.tagSets().some((set) => set.scope === 'team')
          )}
          onClose={props.onClose}
        />
      )}
    </Show>
  );
}

function TagChip(props: {
  tag: ResolvedTag;
  createDocTags: CreateDocTags;
  onFilterByTag?: (id: string) => void;
  onEdit: (tag: ResolvedTag) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  return (
    <Layer depth={2}>
      <HoverCard
        placement="bottom-start"
        disabled={pickerOpen()}
        content={
          <TagHoverContent
            tag={props.tag}
            onFilterByTag={props.onFilterByTag}
            onEdit={props.onEdit}
          />
        }
      >
        <TagPicker
          createDocTags={props.createDocTags}
          triggerClass={chipClass}
          triggerLabel={`Change or select tag ${props.tag.label}`}
          onOpenChange={setPickerOpen}
        >
          <TagDot color={props.tag.color} class="size-2" />
          <span class="min-w-0 truncate">{props.tag.label}</span>
        </TagPicker>
      </HoverCard>
    </Layer>
  );
}

function TagOverflow(props: {
  tags: ResolvedTag[];
  createDocTags: CreateDocTags;
  onFilterByTag?: (id: string) => void;
  onEdit: (tag: ResolvedTag) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const dots = () => props.tags.slice(0, MAX_OVERFLOW_DOTS);
  const count = () =>
    `+${props.tags.length} ${props.tags.length === 1 ? 'tag' : 'tags'}`;

  return (
    <Layer depth={2}>
      <HoverCard
        placement="bottom-end"
        disabled={pickerOpen()}
        content={
          <div class="flex flex-col gap-0.5">
            <For each={props.tags}>
              {(tag) => (
                <HoverTagRow
                  tag={tag}
                  onFilter={props.onFilterByTag}
                  onEdit={props.onEdit}
                />
              )}
            </For>
          </div>
        }
      >
        <TagPicker
          createDocTags={props.createDocTags}
          triggerClass={cn(chipClass, 'gap-1.5')}
          triggerLabel="Edit tags"
          onOpenChange={setPickerOpen}
        >
          <span class="flex items-center">
            <For each={dots()}>
              {(tag, index) => (
                <TagDot
                  color={tag.color}
                  class={cn('size-2 ring ring-surface', index() > 0 && '-ml-1')}
                />
              )}
            </For>
          </span>
          <span>{count()}</span>
        </TagPicker>
      </HoverCard>
    </Layer>
  );
}

/**
 * Compact tag display for list rows, rendered from the entity's already-loaded
 * soup properties (no per-row fetch). Shows up to `maxVisible` chips then a
 * "+N tags" chip. Clicking a chip opens the TagPicker to edit the entity's
 * tags. Hovering a chip surfaces a "Filter by" link and hovering the overflow
 * lists the hidden tags. onFilterByTag applies a tag filter to the list.
 */
export function EntityRowTags(props: {
  entityId: string;
  entityType: EntityType;
  properties: SoupProperty[] | undefined;
  maxVisible?: number;
  class?: string;
  onFilterByTag?: (optionId: string) => void;
}) {
  const appliedTags = useSoupResolvedTags(() => props.properties);
  const createDocTags = () =>
    useSoupDocTags(props.entityId, props.entityType, () => props.properties);
  const maxVisible = () => props.maxVisible ?? DEFAULT_MAX_VISIBLE;
  const visible = () => appliedTags().slice(0, maxVisible());
  const hidden = () => appliedTags().slice(maxVisible());
  const [editingTag, setEditingTag] = createSignal<ResolvedTag>();

  return (
    <Show when={appliedTags().length > 0}>
      <div
        class={cn('flex items-center gap-1', props.class)}
        onClick={(event) => event.stopPropagation()}
      >
        <For each={visible()}>
          {(tag) => (
            <TagChip
              tag={tag}
              createDocTags={createDocTags}
              onFilterByTag={props.onFilterByTag}
              onEdit={setEditingTag}
            />
          )}
        </For>
        <Show when={hidden().length > 0}>
          <TagOverflow
            tags={hidden()}
            createDocTags={createDocTags}
            onFilterByTag={props.onFilterByTag}
            onEdit={setEditingTag}
          />
        </Show>
        <Show when={editingTag()}>
          {(tag) => (
            <RowTagEditorOwner
              tag={tag()}
              createDocTags={createDocTags}
              onClose={() => setEditingTag(undefined)}
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

export function InlineTagsPill(props: {
  docTags: DocTags;
  class?: string;
  showPlaceholder?: boolean;
}) {
  const tags = () => props.docTags.appliedTags();
  const first = () => tags()[0];
  const dots = () => tags().slice(0, MAX_OVERFLOW_DOTS);
  const label = () =>
    `${tags().length} ${tags().length === 1 ? 'Tag' : 'Tags'}`;

  return (
    <Show when={tags().length > 0 || props.showPlaceholder}>
      <Layer depth={2}>
        <TagPicker
          docTags={props.docTags}
          triggerClass={cn(
            'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted',
            'px-2 py-1 leading-tight text-left rounded-full bg-surface',
            'hover:bg-hover text-ink-muted focus-visible:bg-active focus-visible:ring-accent/10',
            tags().length === 0 && 'text-ink-extra-muted',
            props.class
          )}
          triggerLabel="Change or select tags"
        >
          <Switch>
            <Match when={tags().length === 0}>
              <span class="inline-flex min-w-0 items-center gap-1.5 opacity-50">
                <CircleDashedEmpty class="size-3 shrink-0" />
                <span class="min-w-0 truncate @max-2xl/u-list:hidden">
                  Tags
                </span>
              </span>
            </Match>
            <Match when={tags().length === 1 && first()}>
              {(tag) => (
                <>
                  <TagDot color={tag().color} class="size-2.5" />
                  <span class="min-w-0 truncate @max-2xl/u-list:hidden">
                    {tag().label}
                  </span>
                </>
              )}
            </Match>
            <Match when={tags().length > 1}>
              <span class="flex items-center">
                <For each={dots()}>
                  {(tag, index) => (
                    <TagDot
                      color={tag.color}
                      class={cn(
                        'size-2.5 ring-2 ring-surface',
                        index() > 0 && '-ml-1'
                      )}
                    />
                  )}
                </For>
              </span>
              <span class="min-w-0 truncate @max-2xl/u-list:hidden">
                {label()}
              </span>
            </Match>
          </Switch>
          <CaretDownIcon class="size-3 shrink-0 @max-2xl/u-list:hidden" />
        </TagPicker>
      </Layer>
    </Show>
  );
}

export function InlineEntityTagsPill(props: {
  entityId: string;
  entityType: EntityType;
  properties: SoupProperty[] | undefined;
  class?: string;
}) {
  const docTags = useSoupDocTags(
    props.entityId,
    props.entityType,
    () => props.properties
  );
  return (
    <InlineTagsPill
      docTags={docTags}
      class={props.class}
      showPlaceholder={props.entityType === EntityType.TASK}
    />
  );
}

export function InlineFetchedEntityTagsPill(props: {
  entityId: string;
  entityType: EntityType;
  class?: string;
}) {
  const docTags = useDocTags(props.entityId, props.entityType);
  return (
    <InlineTagsPill
      docTags={docTags}
      class={props.class}
      showPlaceholder={props.entityType === EntityType.TASK}
    />
  );
}
