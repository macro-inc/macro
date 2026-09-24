/**
 * A turn failure the person can act on, as a card: what happened, what to do,
 * and where to do it.
 *
 * The runtime classified the failure (a spent Cursor budget, say) and wrote
 * it in the person's terms, so this shows it as an instruction — the same
 * card shape as a permission request, in the failure ink — rather than as the
 * quiet rule an opaque runtime error gets.
 */

import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import type { FailureNotice } from '@service-agent-fold/generated/types';
import { Button } from '@ui';
import { Show } from 'solid-js';

export interface FailureNoticeCardProps {
  notice: FailureNotice;
  /** Follows the notice's link; wired to the app's external-url handling. */
  onOpenLink: (url: string) => void;
}

export function FailureNoticeCard(props: FailureNoticeCardProps) {
  return (
    <section
      aria-label={props.notice.title}
      class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-4 pt-4">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-failure-bg text-failure">
          <WarningCircle class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">{props.notice.title}</div>
          <p class="mt-0.5 text-xs leading-5 text-ink-muted [overflow-wrap:anywhere]">
            {props.notice.body}
          </p>
        </div>
      </div>
      <div class="p-3">
        <Show when={props.notice.link}>
          {(link) => (
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="gap-1.5"
              onClick={() => props.onOpenLink(link().url)}
            >
              <span>{link().label}</span>
              <ArrowSquareOut class="size-3.5" />
            </Button>
          )}
        </Show>
      </div>
    </section>
  );
}
