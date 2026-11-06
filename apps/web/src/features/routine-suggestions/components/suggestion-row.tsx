import LightningIcon from '@icon/system/regular/lightning.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import type { Surface } from '@service-scheduled-action/generated/schemas';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { surfaceLook } from '../../routines/components/routine-template-strip';
import type { SuggestionSummary } from '../core/suggestion-draft';

/**
 * One suggested routine: what it does and when, why AI picked it, Review
 * (which opens it before anything is saved) and Not interested.
 */
export function SuggestionRow(props: {
  summary: SuggestionSummary;
  surface: Surface;
  reason: string;
  /** A request the drafter writes on review, rather than a catalog routine. */
  drafted: boolean;
  /** Shown where suggestions of every surface are listed. */
  surfaceLabel?: string;
  /** This one is being drafted or opened. */
  pending: boolean;
  /** Another one is being drafted or opened. */
  busy: boolean;
  onReview(): void;
  onDismiss(): void;
}) {
  const look = () => surfaceLook(props.surface);
  return (
    <li class="group/suggestion flex min-w-0 list-none items-start gap-3 rounded-xl p-3 not-touch:hover:bg-hover">
      <Dynamic
        component={look().icon}
        class={cn('mt-0.5 size-4 shrink-0', look().tint)}
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-ink">
            {props.summary.title}
          </span>
          <Show when={props.surfaceLabel}>
            {(label) => (
              <span class="shrink-0 rounded-full bg-violet-bg px-1.5 text-[10px] leading-4 font-medium text-violet-ink">
                {label()}
              </span>
            )}
          </Show>
        </div>
        <p class="mt-0.5 text-xs leading-5 text-ink-muted">
          {props.summary.does}
        </p>
        <p class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-extra-muted">
          <Show
            when={props.summary.when}
            fallback={
              <span class="flex items-center gap-1 text-violet-ink">
                <SparkleIcon
                  class="size-3.5"
                  aria-hidden="true"
                  data-icon-motion="none"
                />
                AI drafts it for you to review
              </span>
            }
          >
            {(when) => (
              <span class="flex items-center gap-1 text-violet-ink">
                <LightningIcon
                  class="size-3.5"
                  aria-hidden="true"
                  data-icon-motion="none"
                />
                {when()}
              </span>
            )}
          </Show>
          <span class="min-w-0">{props.reason}</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={props.busy}
          onClick={() => props.onReview()}
        >
          {props.pending
            ? props.drafted
              ? 'Drafting…'
              : 'Opening…'
            : 'Review'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Not interested in ${props.summary.title}`}
          title="Not interested"
          disabled={props.pending}
          onClick={() => props.onDismiss()}
        >
          <XIcon class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}
