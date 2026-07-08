import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, Layer } from '@ui';
import { For, Show } from 'solid-js';
import { TagDot } from './TagDot';
import { TagPicker } from './TagPicker';
import { useDocTags } from './useDocTags';

const chipClass = cn(
  'inline-flex items-center gap-1.5 min-w-0 max-w-[30ch]',
  'px-2 py-1 leading-tight rounded-full bg-surface'
);

export function TagsRow(props: {
  entityId: string;
  entityType: EntityType;
  canEdit: boolean;
}) {
  const docTags = useDocTags(props.entityId, props.entityType);

  return (
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={docTags.appliedTags()}>
        {(tag) => (
          <Layer depth={2}>
            <span class={chipClass}>
              <TagDot color={tag.color} />
              <span class="min-w-0 truncate">{tag.label}</span>
            </span>
          </Layer>
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
      </Show>
    </div>
  );
}
