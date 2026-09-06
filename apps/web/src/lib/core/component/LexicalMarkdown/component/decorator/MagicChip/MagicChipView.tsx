import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { PulsingStar } from '@entity/components/PulsingStar';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { Layer } from '@ui';
import {
  type Component,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { MagicChipActivity, MagicChipPresentation } from './presentation';

function answerMarkdown(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? undefined : presentation.markdown;
}

function currentActivity(presentation: MagicChipPresentation) {
  return presentation.kind === 'settled' ? undefined : presentation.activity;
}

function replyPreview(activity: MagicChipActivity | undefined) {
  if (!activity) return 'Open session';
  return `${activity.label}${activity.detail ? ` ${activity.detail}` : ''}`;
}

/** The shimmering label plus its muted detail. */
const ActivityText: Component<{ activity: MagicChipActivity }> = (props) => (
  <>
    <span
      class="shrink-0"
      classList={{
        'magic-chip-shimmer': props.activity.busy,
        'text-ink-muted': !props.activity.busy,
      }}
      aria-live="polite"
    >
      {props.activity.label}
    </span>
    <Show when={props.activity.detail}>
      {(detail) => (
        <>
          <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
            ·
          </span>
          <span
            class="min-w-0 flex-1 truncate text-ink-extra-muted"
            title={detail()}
          >
            {detail()}
          </span>
        </>
      )}
    </Show>
  </>
);

/**
 * Holds the answer's space until the agent writes: the chat's own waiting
 * glyph, pulsing while the agent is busy and still while it is not (a
 * disconnected session, a turn that ended without prose).
 */
const AnswerPending: Component<{ busy: boolean }> = (props) => (
  <div
    class="flex h-full items-center justify-center"
    data-magic-chip-pending
    aria-hidden="true"
  >
    <PulsingStar kind="streamIndicator" animate={props.busy} />
  </div>
);

/**
 * The answer: clipped to four lines with a fade while collapsed, whole once
 * expanded. The fade only shows when the text is actually taller than the
 * clip, so short answers read whole either way.
 */
const AnswerBody: Component<{ markdown: string; expanded: boolean }> = (
  props
) => {
  const [overflowing, setOverflowing] = createSignal(false);
  let clip: HTMLDivElement | undefined;

  onMount(() => {
    const el = clip;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={(el) => {
        clip = el;
      }}
      class="relative"
      classList={{ 'h-full overflow-hidden': !props.expanded }}
      data-magic-chip-clip
    >
      <div
        class="pointer-events-none min-w-0 max-w-full wrap-break-word"
        data-message-reply-preview
      >
        <StaticMarkdownContext theme={channelTheme}>
          <StaticMarkdown markdown={props.markdown} target="external" />
        </StaticMarkdownContext>
      </div>
      <Show when={overflowing() && !props.expanded}>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-b from-transparent via-surface/80 to-surface group-hover/answer:via-hover/80 group-hover/answer:to-hover" />
        <ExpandHint expanded={false} />
      </Show>
      <Show when={props.expanded}>
        <ExpandHint expanded />
      </Show>
    </div>
  );
};

/** The disclosure cue: `Show more` over the fade, `Show less` under the text. */
const ExpandHint: Component<{ expanded: boolean }> = (props) => (
  <span
    class="pointer-events-none flex items-center gap-1 text-xs text-ink-extra-muted group-hover/answer:text-ink-muted"
    classList={{
      'absolute right-0 bottom-0 pb-0.5': !props.expanded,
      'pt-1 pb-0.5': props.expanded,
    }}
    aria-hidden="true"
  >
    <CaretRight
      class="size-3 shrink-0 transition-transform motion-reduce:transition-none"
      classList={{ 'rotate-90': props.expanded }}
    />
    {props.expanded ? 'Show less' : 'Show more'}
  </span>
);

/**
 * One card for the whole turn: the answer area is reserved from the first
 * moment (a pulsing star while the agent works, the opening of the answer
 * once it writes) so the thread never jumps, and the bottom row reads the
 * current activity or `Open session`. Clicking the answer expands it in
 * place; clicking the row opens the session.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  onOpen?: () => void;
}> = (props) => {
  const markdown = () => answerMarkdown(props.presentation);
  const activity = () => currentActivity(props.presentation);
  const [expanded, setExpanded] = createSignal(false);

  // Before there is an answer there is nothing to expand, so the whole card
  // leads to the session.
  const onAnswerClick = () => {
    if (markdown()) setExpanded((open) => !open);
    else props.onOpen?.();
  };

  return (
    <Layer depth={2}>
      <div
        class="my-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-edge-muted bg-surface"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onMouseDown={(event) => event.preventDefault()}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={markdown() ? expanded() : undefined}
          class="group/answer px-3 py-1 text-left hover:bg-hover"
          classList={{ 'h-22': !expanded() }}
          data-magic-chip-answer
          onClick={onAnswerClick}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onAnswerClick();
          }}
        >
          <Show
            when={markdown()}
            fallback={<AnswerPending busy={activity()?.busy ?? false} />}
          >
            {(answer) => (
              <AnswerBody markdown={answer()} expanded={expanded()} />
            )}
          </Show>
        </div>
        <button
          type="button"
          class="flex min-h-9 w-full items-center gap-1.5 border-t border-edge-muted px-3 py-2 text-left text-xs leading-5 text-ink-extra-muted hover:bg-hover"
          data-message-reply-preview={
            markdown() ? undefined : replyPreview(activity())
          }
          disabled={!props.onOpen}
          onClick={props.onOpen}
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <Show
              when={activity()}
              fallback={<span class="text-ink-muted">Open session</span>}
            >
              {(current) => <ActivityText activity={current()} />}
            </Show>
          </span>
          <ArrowUpRight aria-hidden="true" class="size-3 shrink-0" />
        </button>
      </div>
    </Layer>
  );
};
