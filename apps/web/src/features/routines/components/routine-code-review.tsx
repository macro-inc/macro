import { t } from '@app/lib/i18n';
import WarningIcon from '@icon/system/regular/warning-circle.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { CodeReview } from '../core/code-review';

/**
 * A routine whose code Macro's SDK changed under: why, the update AI
 * proposed (each changed step's code before and after), and approving it,
 * which checks it again and resumes the routine. It is paused unless only
 * its sub-routines run that code, whose copies fail until then.
 */
export function CodeReviewNotice(props: {
  review: CodeReview;
  paused: boolean;
  disabled: boolean;
  onApprove(): void;
  onDiscardEdits?(): void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <section
      aria-label="Code update needed"
      class="grid min-w-0 gap-3 rounded-xl border border-failure/30 bg-failure-bg px-4 py-3"
    >
      <div class="flex min-w-0 gap-2.5">
        <WarningIcon class="mt-0.5 size-4 shrink-0 text-failure" />
        <div class="grid min-w-0 gap-1">
          <span class="text-sm font-medium text-ink">
            {props.paused
              ? 'Paused: its code needs an update'
              : 'Its sub-routines’ code needs an update'}
          </span>
          <span class="whitespace-pre-wrap text-sm text-ink-muted">
            {props.review.reason}
          </span>
        </div>
      </div>
      <Show
        when={props.review.proposal}
        fallback={
          <span class="text-xs text-ink-muted">
            {props.paused
              ? 'Ask AI on this routine to update its code, then turn it back on.'
              : 'Ask AI on this routine to update its code.'}
          </span>
        }
      >
        {(proposal) => (
          <>
            <Show when={open()}>
              <For each={proposal().changes}>
                {(change) => (
                  <div class="grid min-w-0 gap-1.5">
                    <span class="text-xs font-medium text-ink-muted">
                      {change.title}
                    </span>
                    <div class="grid min-w-0 gap-2 @[40rem]/routine:grid-cols-2">
                      <CodeBlock label="Before" source={change.before} />
                      <CodeBlock label="Proposed" source={change.after} />
                    </div>
                  </div>
                )}
              </For>
            </Show>
            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={props.disabled}
                onClick={() => props.onApprove()}
              >
                {props.paused ? 'Approve and resume' : 'Approve'}
              </Button>
              <Show when={props.onDiscardEdits}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.onDiscardEdits}
                >
                  {t('subRoutines.discardEdits')}
                </Button>
              </Show>
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={open()}
                onClick={() => setOpen(!open())}
              >
                {open() ? 'Hide the update' : 'Review the update'}
              </Button>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}

function CodeBlock(props: { label: string; source: string }) {
  return (
    <figure class="grid min-w-0 gap-1">
      <figcaption class="text-xs text-ink-muted">{props.label}</figcaption>
      <pre class="max-h-64 min-w-0 overflow-auto rounded-lg border border-edge-frame bg-control px-3 py-2 font-mono text-xs leading-relaxed text-ink">
        <code>{props.source}</code>
      </pre>
    </figure>
  );
}
