import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import {
  type Component,
  createEffect,
  Match,
  on,
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

/** Fixed-height activity line — no box, just a shimmering label in the flow. */
const ActivityLine: Component<{
  agentSessionId: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <button
    type="button"
    class="flex h-6 w-full min-w-0 items-center gap-2 text-left"
    data-magic-chip={props.agentSessionId}
    data-message-reply-preview={`${props.activity.label}${
      props.activity.detail ? ` ${props.activity.detail}` : ''
    }`}
    disabled={!props.onOpen}
    onMouseDown={(event) => event.preventDefault()}
    onClick={props.onOpen}
  >
    <span
      class="shrink-0 text-xs font-semibold"
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
        <span class="min-w-0 truncate text-xs text-ink-extra-muted">
          {detail()}
        </span>
      )}
    </Show>
  </button>
);

function pinToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
}

/**
 * Quoted answer preview. Fixed height so the thread does not grow as the
 * agent writes; the latest text stays in view, and a click opens the session.
 */
const AnswerBody: Component<{
  markdown: string;
  onOpen?: () => void;
}> = (props) => {
  let scroller: HTMLDivElement | undefined;

  onMount(() => {
    const el = scroller;
    if (!el) return;
    pinToBottom(el);
    const inner = el.firstElementChild;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => pinToBottom(el));
    observer.observe(inner);
    onCleanup(() => observer.disconnect());
  });

  createEffect(
    on(
      () => props.markdown,
      () => {
        const el = scroller;
        if (el) pinToBottom(el);
      }
    )
  );

  return (
    <div
      ref={(el) => {
        scroller = el;
      }}
      class="h-36 w-full min-w-0 max-w-full overflow-auto overscroll-contain border-l-2 border-accent pl-3 text-left text-sm leading-6"
      data-magic-chip-preview
      data-message-reply-preview
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onOpen}
    >
      <div class="pointer-events-none min-w-0 max-w-full wrap-break-word">
        <StaticMarkdownContext theme={channelTheme}>
          <StaticMarkdown markdown={props.markdown} target="external" />
        </StaticMarkdownContext>
      </div>
    </div>
  );
};

/**
 * The answer as it is being written, with the activity line beneath it.
 *
 * The same quoted body the settled state uses, so the turn ending changes
 * only what is under the answer, not the answer itself — no reflow at the
 * moment the agent stops.
 */
const StreamingAnswer: Component<{
  agentSessionId: string;
  markdown: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <div
    class="grid w-full min-w-0 justify-items-start gap-1"
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} onOpen={props.onOpen} />
    <div class="w-full pl-3">
      <ActivityLine
        agentSessionId={props.agentSessionId}
        activity={props.activity}
        onOpen={props.onOpen}
      />
    </div>
  </div>
);

/** The settled response, quoted as if the agent had answered inline. */
const SettledAnswer: Component<{
  agentSessionId: string;
  markdown: string;
  onOpen?: () => void;
}> = (props) => (
  <div
    class="grid w-full min-w-0 justify-items-start gap-1"
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} onOpen={props.onOpen} />
    <button
      type="button"
      class="pl-3.5 mb-2 text-xs text-ink-extra-muted hover:text-ink"
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onOpen}
      disabled={!props.onOpen}
    >
      Open session
    </button>
  </div>
);

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
        <StreamingAnswer
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          activity={presentation().activity}
          onOpen={props.onOpen}
        />
      )}
    </Match>
    <Match when={settled(props.presentation)}>
      {(presentation) => (
        <SettledAnswer
          agentSessionId={props.agentSessionId}
          markdown={presentation().markdown}
          onOpen={props.onOpen}
        />
      )}
    </Match>
  </Switch>
);
