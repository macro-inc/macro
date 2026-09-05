import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { type Component, Match, Show, Switch } from 'solid-js';
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

/** Stay inside the chat column; wide streaming markdown must not grow it. */
const CHIP_SHELL = 'w-full min-w-0 max-w-full overflow-x-hidden';

/** Fixed-height activity line — no box, just a shimmering label in the flow. */
const ActivityLine: Component<{
  agentSessionId: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <button
    type="button"
    class={`flex h-6 items-center gap-2 overflow-hidden text-left ${CHIP_SHELL}`}
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

/** The response, quoted as if the agent had answered inline. */
const AnswerBody: Component<{ markdown: string }> = (props) => (
  <div
    class="chat-markdown-container w-full min-w-0 max-w-full overflow-x-auto wrap-break-word whitespace-pre-wrap border-l-2 border-accent pl-3 text-left text-sm leading-6"
    data-message-reply-preview
  >
    <StaticMarkdownContext theme={channelTheme}>
      <StaticMarkdown markdown={props.markdown} target="external" />
    </StaticMarkdownContext>
  </div>
);

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
    class={`grid justify-items-stretch gap-1 ${CHIP_SHELL}`}
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} />
    <div class={`pl-3 ${CHIP_SHELL}`}>
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
    class={`grid justify-items-stretch gap-1 ${CHIP_SHELL}`}
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} />
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
