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
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { MagicChipActivity, MagicChipPresentation } from './presentation';

function working(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? presentation : undefined;
}

function answering(presentation: MagicChipPresentation) {
  return presentation.kind === 'answering' ? presentation : undefined;
}

function settled(presentation: MagicChipPresentation) {
  return presentation.kind === 'settled' ? presentation : undefined;
}

function replyPreview(activity: MagicChipActivity) {
  return `${activity.label}${activity.detail ? ` ${activity.detail}` : ''}`;
}

/** The shimmering label plus its muted detail, shared by every activity row. */
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

/** Fixed-height activity line — no box, just a shimmering label in the flow. */
const ActivityLine: Component<{
  agentSessionId: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <button
    type="button"
    class="flex h-6 w-full min-w-0 items-center gap-1.5 text-left text-xs"
    data-magic-chip={props.agentSessionId}
    data-message-reply-preview={replyPreview(props.activity)}
    disabled={!props.onOpen}
    onMouseDown={(event) => event.preventDefault()}
    onClick={props.onOpen}
  >
    <ActivityText activity={props.activity} />
  </button>
);

/**
 * The answer as a card: the opening of the response, clipped to six lines
 * and faded out, with a footer that says what the agent is doing (or that it
 * is done). Clicking anywhere opens the session for the rest.
 */
const AnswerCard: Component<{
  agentSessionId: string;
  markdown: string;
  activity?: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => {
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
    <Layer depth={2}>
      <div
        class="my-2 w-full overflow-hidden rounded-lg border border-edge-muted bg-surface"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onOpen}
      >
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
        <button
          type="button"
          class="flex min-h-9 w-full items-center gap-1.5 border-t border-edge-muted px-3 py-2 text-left text-xs leading-5 text-ink-extra-muted hover:bg-hover"
          disabled={!props.onOpen}
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
            <Show
              when={props.activity}
              fallback={<span class="text-ink-muted">Open session</span>}
            >
              {(activity) => <ActivityText activity={activity()} />}
            </Show>
          </span>
          <ArrowUpRight aria-hidden="true" class="size-3 shrink-0" />
        </button>
      </div>
    </Layer>
  );
};

/** Render an already-derived Magic Chip presentation. */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  onOpen?: () => void;
}> = (props) => (
  <Switch>
    <Match when={working(props.presentation)}>
      {(presentation) => (
        <ActivityLine
          agentSessionId={props.agentSessionId}
          activity={presentation().activity}
          onOpen={props.onOpen}
        />
      )}
    </Match>
    <Match when={answering(props.presentation)}>
      {(presentation) => (
        <AnswerCard
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          activity={presentation().activity}
          onOpen={props.onOpen}
        />
      )}
    </Match>
    <Match when={settled(props.presentation)}>
      {(presentation) => (
        <AnswerCard
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          onOpen={props.onOpen}
        />
      )}
    </Match>
  </Switch>
);
