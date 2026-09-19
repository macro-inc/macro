/**
 * An action the session took, rendered as a rule with its label in the
 * middle — or, when it failed, as a readable error rather than a cut-off
 * red line.
 *
 * The quiet treatment is for things that happened *to* the session rather
 * than in it — a model switch, a compaction — so they read as punctuation
 * between turns. A failure is the opposite: the reader needs the runtime's
 * own words, wrapped, not hidden behind a hover title.
 */

import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';

export interface ActionLineProps {
  /** What happened, e.g. `Model set to opus`. */
  label: string;
  /**
   * The action did not take. Reads as a wrapping error instead of the
   * quiet rule, so a refused action cannot be mistaken for one that went
   * through — and so a long runtime message is not cut off.
   */
  failed?: boolean;
  /**
   * Verbatim detail behind the label — a runtime's error message. On a
   * quiet line this is a hover title; on a failed line it is the body.
   */
  detail?: string;
  /** Optional glyph before the label. */
  icon?: JSX.Element;
}

export function ActionLine(props: ActionLineProps) {
  return (
    <Show when={props.failed} fallback={<QuietLine {...props} />}>
      <FailedLine {...props} />
    </Show>
  );
}

function QuietLine(props: ActionLineProps) {
  return (
    <div class="flex w-full items-center gap-4 px-4 py-1 text-xs text-ink-extra-muted">
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
      <span class="flex min-w-0 items-center gap-1.5" title={props.detail}>
        <Show when={props.icon}>
          <span aria-hidden="true" class="flex shrink-0 items-center">
            {props.icon}
          </span>
        </Show>
        <span class="min-w-0 truncate">{props.label}</span>
      </span>
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
    </div>
  );
}

function FailedLine(props: ActionLineProps) {
  const [copied, setCopied] = createSignal(false);
  const copyText = () => props.detail ?? props.label;

  const copy = async () => {
    const text = copyText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard', error);
    }
  };

  return (
    <div
      role="alert"
      class="flex w-full min-w-0 items-start gap-2 border-l-2 border-failure px-4 py-1.5 text-xs leading-5"
      title={props.detail}
    >
      <Show
        when={props.icon}
        fallback={
          <WarningCircleIcon
            aria-hidden="true"
            class="mt-0.5 size-3.5 shrink-0 text-failure"
          />
        }
      >
        <span
          aria-hidden="true"
          class="mt-0.5 flex shrink-0 items-center text-failure"
        >
          {props.icon}
        </span>
      </Show>
      <div class="min-w-0 flex-1">
        <p class="font-medium wrap-break-word text-failure">{props.label}</p>
        <Show when={props.detail}>
          {(detail) => (
            <p class="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word text-failure/80">
              {detail()}
            </p>
          )}
        </Show>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        noTouchResize
        class="shrink-0 px-1 text-ink-extra-muted hover:text-ink-muted"
        aria-label={copied() ? 'Copied' : 'Copy error'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
      >
        <Show when={copied()} fallback={<Copy class="size-3.5" />}>
          <Check class="size-3.5 text-success" />
        </Show>
      </Button>
    </div>
  );
}
