import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { type Component, type JSX, Match, Show, Switch } from 'solid-js';
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

/**
 * Keep the chip as wide as the message column, never as wide as its content.
 * Streamed markdown used to shrink-wrap and grow sideways, so each token
 * reflowed the quote and eventually ran off the right edge.
 */
const ChipFrame: Component<{
  agentSessionId: string;
  children: JSX.Element;
}> = (props) => (
  <div
    class="flex w-full min-w-0 max-w-full flex-col overflow-x-hidden"
    data-magic-chip={props.agentSessionId}
  >
    {props.children}
  </div>
);

/** Fixed-height activity line — no box, just a shimmering label in the flow. */
const ActivityLine: Component<{
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <button
    type="button"
    class="flex h-6 w-full min-w-0 items-center gap-2 overflow-hidden text-left"
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
  <div class="w-full min-w-0 max-w-full overflow-x-hidden wrap-break-word border-l-2 border-accent pl-3 text-left text-sm leading-6">
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
  markdown: string;
  activity: MagicChipActivity;
  onOpen?: () => void;
}> = (props) => (
  <div class="flex w-full min-w-0 flex-col gap-1">
    <AnswerBody markdown={props.markdown} />
    <div class="w-full min-w-0 pl-3">
      <ActivityLine activity={props.activity} onOpen={props.onOpen} />
    </div>
  </div>
);

/** The settled response, quoted as if the agent had answered inline. */
const SettledAnswer: Component<{
  markdown: string;
  onOpen?: () => void;
}> = (props) => (
  <div class="flex w-full min-w-0 flex-col gap-1">
    <AnswerBody markdown={props.markdown} />
    <button
      type="button"
      class="mb-2 pl-3 text-left text-xs text-ink-extra-muted hover:text-ink"
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
  <ChipFrame agentSessionId={props.agentSessionId}>
    <Switch>
      <Match when={working(props.presentation)}>
        {(presentation) => (
          <ActivityLine
            activity={presentation().activity}
            onOpen={props.onOpen}
          />
        )}
      </Match>
      <Match when={answering(props.presentation)}>
        {(presentation) => (
          <StreamingAnswer
            markdown={presentation().markdown}
            activity={presentation().activity}
            onOpen={props.onOpen}
          />
        )}
      </Match>
      <Match when={settled(props.presentation)}>
        {(presentation) => (
          <SettledAnswer
            markdown={presentation().markdown}
            onOpen={props.onOpen}
          />
        )}
      </Match>
    </Switch>
  </ChipFrame>
);
