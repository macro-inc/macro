import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
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
    >
      {props.activity.label}
    </span>
    <Show when={props.activity.detail}>
      {(detail) => (
        <>
          <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
            ·
          </span>
          <span class="min-w-0 truncate text-ink-extra-muted" title={detail()}>
            {detail()}
          </span>
        </>
      )}
    </Show>
  </>
);

/**
 * The opening of the answer, clipped to six lines. The fade only shows once
 * the text is actually taller than the clip, so short answers read whole.
 */
const AnswerBody: Component<{ markdown: string }> = (props) => {
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
      class="relative max-h-32 overflow-hidden px-3 py-1"
      data-message-reply-preview
    >
      <div class="pointer-events-none min-w-0 max-w-full wrap-break-word">
        <StaticMarkdownContext theme={channelTheme}>
          <StaticMarkdown markdown={props.markdown} target="external" />
        </StaticMarkdownContext>
      </div>
      <Show when={overflowing()}>
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-b from-transparent to-surface" />
      </Show>
    </div>
  );
};

/**
 * One card for the whole turn, so the chrome is there from the first
 * moment: a status row while the agent works, the opening of the answer
 * above that row as it is written, and `Open session` once the turn ends.
 * Clicking anywhere opens the session.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  onOpen?: () => void;
}> = (props) => {
  const markdown = () => answerMarkdown(props.presentation);
  const activity = () => currentActivity(props.presentation);

  return (
    <Layer depth={2}>
      <div
        class="my-2 w-full overflow-hidden rounded-lg border border-edge-muted bg-surface"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onOpen}
      >
        <Show when={markdown()}>
          {(answer) => <AnswerBody markdown={answer()} />}
        </Show>
        <button
          type="button"
          class="flex min-h-9 w-full items-center gap-1.5 px-3 py-2 text-left text-xs leading-5 text-ink-extra-muted hover:bg-hover"
          classList={{ 'border-t border-edge-muted': Boolean(markdown()) }}
          data-message-reply-preview={
            markdown() ? undefined : replyPreview(activity())
          }
          disabled={!props.onOpen}
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
