import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { rowPillClasses } from './row-pill';

/**
 * Gmail labels or Outlook categories, read-only: Macro never writes them back.
 * A tag glyph instead of a color dot keeps them apart from Macro tags.
 */
export function EmailLabelPills(props: {
  names: readonly string[];
  class?: string;
  pillClass?: string;
}) {
  return (
    <Show when={props.names.length > 0}>
      <span class={cn('flex min-w-0 items-center gap-1', props.class)}>
        <For each={props.names}>
          {(name) => (
            <span
              title={name}
              data-email-label={name}
              class={rowPillClasses(cn('max-w-32 shrink-0', props.pillClass))}
            >
              <TagSimpleIcon class="size-3 shrink-0" />
              <span data-pill-text class="min-w-0 truncate">
                {name}
              </span>
            </span>
          )}
        </For>
      </span>
    </Show>
  );
}
