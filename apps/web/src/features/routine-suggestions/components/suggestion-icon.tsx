import type { Surface } from '@service-scheduled-action/generated/schemas';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { surfaceLook } from '../../routines/components/routine-template-strip';

/** A suggestion's area icon in a soft violet tile. */
export function SuggestionIcon(props: { surface: Surface; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-bg text-violet-ink',
        props.class
      )}
    >
      <Dynamic component={surfaceLook(props.surface).icon} class="size-4" />
    </span>
  );
}
