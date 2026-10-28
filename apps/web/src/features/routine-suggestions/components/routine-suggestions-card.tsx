import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { RoutineSparkGlyph } from './routine-spark-glyph';

/**
 * The compact "Suggested routines" card at the top of a view sidebar. The
 * whole card opens the suggestions; the close button dismisses it.
 */
export function RoutineSuggestionsCard(props: {
  /** Names the top suggestion once one exists, else the surface pitch. */
  teaser: string;
  /** Suggestions beyond the teased one, shown as "+N more". */
  more: number;
  onOpen(trigger: HTMLButtonElement): void;
  onDismiss(): void;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'group/routine-card relative min-w-0 shrink-0 rounded-xl border border-violet/20 bg-panel transition-colors not-touch:hover:border-violet/40',
        props.class
      )}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        class="flex w-full min-w-0 items-center gap-2.5 rounded-xl py-2 pr-9 pl-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent touch:min-h-[44px]"
        onClick={(event) => props.onOpen(event.currentTarget)}
      >
        <RoutineSparkGlyph />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-medium text-ink">
            Suggested routines
          </span>
          <span class="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-ink-muted">
            <span class="truncate">{props.teaser}</span>
            <Show when={props.more > 0}>
              <span class="shrink-0 text-violet-ink">+{props.more}</span>
            </Show>
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss suggested routines"
        class="absolute top-1/2 right-1.5 -translate-y-1/2 not-touch:opacity-0 not-touch:group-hover/routine-card:opacity-100 not-touch:focus-visible:opacity-100"
        onClick={() => props.onDismiss()}
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
