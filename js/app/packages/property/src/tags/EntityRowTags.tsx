import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, HoverCard, Layer } from '@ui';
import { For, Show } from 'solid-js';
import { TagDot } from './TagDot';
import { type ResolvedTag, useDocTags } from './useDocTags';

const DEFAULT_MAX_VISIBLE = 3;
const MAX_OVERFLOW_DOTS = 3;

const chipClass = cn(
  'inline-flex items-center gap-1 shrink-0 max-w-[14ch]',
  'px-1.5 py-0.5 leading-tight rounded-full bg-surface text-ink-muted text-xs'
);

function TagChip(props: { tag: ResolvedTag }) {
  return (
    <Layer depth={2}>
      <span class={chipClass}>
        <TagDot color={props.tag.color} class="size-2" />
        <span class="min-w-0 truncate">{props.tag.label}</span>
      </span>
    </Layer>
  );
}

function TagOverflow(props: { tags: ResolvedTag[] }) {
  const dots = () => props.tags.slice(0, MAX_OVERFLOW_DOTS);
  const count = () =>
    `+${props.tags.length} ${props.tags.length === 1 ? 'tag' : 'tags'}`;

  return (
    <HoverCard
      content={
        <div class="flex flex-col gap-1.5">
          <For each={props.tags}>
            {(tag) => (
              <span class="flex items-center gap-1.5 whitespace-nowrap text-ink">
                <TagDot color={tag.color} />
                <span>{tag.label}</span>
              </span>
            )}
          </For>
        </div>
      }
    >
      <Layer depth={2}>
        <span class={cn(chipClass, 'gap-1.5')}>
          <span class="flex items-center">
            <For each={dots()}>
              {(tag, index) => (
                <TagDot
                  color={tag.color}
                  class={cn(
                    'size-2 ring-1 ring-surface',
                    index() > 0 && '-ml-1'
                  )}
                />
              )}
            </For>
          </span>
          <span>{count()}</span>
        </span>
      </Layer>
    </HoverCard>
  );
}

/**
 * Compact, read-only tag display for list rows. Shows up to `maxVisible` chips
 * then collapses the rest into a "+N tags" chip whose hover reveals the
 * remaining tags. Editing lives in the TagPicker on the entity's detail view.
 */
export function EntityRowTags(props: {
  entityId: string;
  entityType: EntityType;
  maxVisible?: number;
  class?: string;
}) {
  const docTags = useDocTags(props.entityId, props.entityType);
  const maxVisible = () => props.maxVisible ?? DEFAULT_MAX_VISIBLE;
  const visible = () => docTags.appliedTags().slice(0, maxVisible());
  const hidden = () => docTags.appliedTags().slice(maxVisible());

  return (
    <Show when={docTags.appliedTags().length > 0}>
      <div class={cn('flex items-center gap-1', props.class)}>
        <For each={visible()}>{(tag) => <TagChip tag={tag} />}</For>
        <Show when={hidden().length > 0}>
          <TagOverflow tags={hidden()} />
        </Show>
      </div>
    </Show>
  );
}
