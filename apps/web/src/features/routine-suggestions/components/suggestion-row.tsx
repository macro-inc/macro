import LightningIcon from '@icon/system/regular/lightning.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import type { Surface } from '@service-scheduled-action/generated/schemas';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { SuggestionSummary } from '../core/suggestion-draft';
import { SuggestionIcon } from './suggestion-icon';

/**
 * One suggested routine: a title, what it does, and when it runs with why
 * AI picked it, beside Review (which opens it before anything is saved) and
 * Not interested.
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
  return (
    <li class="group/suggestion list-none rounded-xl border border-transparent transition-colors not-touch:hover:bg-hover">
      <div class="flex min-w-0 items-start gap-3 p-3">
        <SuggestionIcon surface={props.surface} class="mt-0.5" />
        <div class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-2">
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
          </span>
          <span class="mt-0.5 block text-xs leading-5 text-ink-muted">
            {props.summary.does}
          </span>
          <span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-extra-muted">
            <span class="flex items-center gap-1 text-violet-ink">
              <Show
                when={props.summary.when}
                fallback={
                  <>
                    <SparkleIcon
                      class="size-3.5"
                      aria-hidden="true"
                      data-icon-motion="none"
                    />
                    AI drafts it for you to review
                  </>
                }
              >
                {(when) => (
                  <>
                    <LightningIcon
                      class="size-3.5"
                      aria-hidden="true"
                      data-icon-motion="none"
                    />
                    {when()}
                  </>
                )}
              </Show>
            </span>
            <span class="min-w-0 truncate">{props.reason}</span>
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Not interested in ${props.summary.title}`}
            title="Not interested"
            class="not-touch:opacity-0 not-touch:group-hover/suggestion:opacity-100 not-touch:focus-visible:opacity-100"
            disabled={props.pending}
            onClick={() => props.onDismiss()}
          >
            <XIcon class="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            aria-label={`Review ${props.summary.title}`}
            onClick={() => props.onReview()}
          >
            {props.pending
              ? props.drafted
                ? 'Drafting…'
                : 'Opening…'
              : 'Review'}
          </Button>
        </div>
      </div>
    </li>
  );
}
