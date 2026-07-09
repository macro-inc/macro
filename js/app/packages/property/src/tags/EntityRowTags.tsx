import FilterIcon from '@phosphor/funnel-simple.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { cn, HoverCard, Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { TagDot } from './TagDot';
import { TagPicker } from './TagPicker';
import { type ResolvedTag, useSoupDocTags } from './useDocTags';

type DocTags = ReturnType<typeof useSoupDocTags>;

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
}) {
  return (
    <Show
      when={props.onFilter}
      fallback={
        <span class="flex items-center gap-1.5 whitespace-nowrap px-1.5 py-1 text-ink">
          <TagDot color={props.tag.color} />
          <span class="min-w-0 truncate">{props.tag.label}</span>
        </span>
      }
    >
      {(onFilter) => (
        <button
          type="button"
          class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-left text-ink hover:bg-hover"
          onClick={() => onFilter()(props.tag.optionId)}
        >
          <TagDot color={props.tag.color} />
          <span class="min-w-0 truncate">{props.tag.label}</span>
        </button>
      )}
    </Show>
  );
}

function TagChip(props: {
  tag: ResolvedTag;
  docTags: DocTags;
  onFilterByTag?: (id: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  return (
    <Layer depth={2}>
      <HoverCard
        placement="bottom-start"
        disabled={pickerOpen() || !props.onFilterByTag}
        content={
          <button
            type="button"
            class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-ink hover:bg-hover"
            onClick={() => props.onFilterByTag?.(props.tag.optionId)}
          >
            <FilterIcon class="size-3.5 text-ink-muted" />
            <span>
              Filter by <span class="font-medium">{props.tag.label}</span>
            </span>
          </button>
        }
      >
        <TagPicker
          docTags={props.docTags}
          triggerClass={chipClass}
          triggerLabel={`Edit ${props.tag.label}`}
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
  docTags: DocTags;
  onFilterByTag?: (id: string) => void;
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
                <HoverTagRow tag={tag} onFilter={props.onFilterByTag} />
              )}
            </For>
          </div>
        }
      >
        <TagPicker
          docTags={props.docTags}
          triggerClass={cn(chipClass, 'gap-1.5')}
          triggerLabel="Edit tags"
          onOpenChange={setPickerOpen}
        >
          <span class="flex items-center">
            <For each={dots()}>
              {(tag, index) => (
                <TagDot
                  color={tag.color}
                  class={cn(
                    'size-2 ring ring-surface',
                    index() > 0 && '-ml-1'
                  )}
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
  const docTags = useSoupDocTags(
    props.entityId,
    props.entityType,
    () => props.properties
  );
  const maxVisible = () => props.maxVisible ?? DEFAULT_MAX_VISIBLE;
  const visible = () => docTags.appliedTags().slice(0, maxVisible());
  const hidden = () => docTags.appliedTags().slice(maxVisible());

  return (
    <Show when={docTags.appliedTags().length > 0}>
      <div
        class={cn('flex items-center gap-1', props.class)}
        onClick={(event) => event.stopPropagation()}
      >
        <For each={visible()}>
          {(tag) => (
            <TagChip
              tag={tag}
              docTags={docTags}
              onFilterByTag={props.onFilterByTag}
            />
          )}
        </For>
        <Show when={hidden().length > 0}>
          <TagOverflow
            tags={hidden()}
            docTags={docTags}
            onFilterByTag={props.onFilterByTag}
          />
        </Show>
      </div>
    </Show>
  );
}
