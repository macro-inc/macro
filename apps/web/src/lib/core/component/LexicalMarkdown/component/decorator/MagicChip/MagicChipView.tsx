import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { type Component, Show } from 'solid-js';
import type { MagicChipActivity, MagicChipPresentation } from './presentation';

/**
 * The whole chip while a turn runs: one line, always `h-6`, whatever the agent
 * is doing.
 *
 * Both halves are held to that line. The label is short and never shrinks; the
 * detail — a thought, a command, a sentence of narration — is arbitrarily long
 * and gets the rest of the row, clipped with `min-w-0` so it can be narrower
 * than its text and truncated at whatever width the message gives it.
 */
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
        <span class="min-w-0 flex-1 truncate text-xs text-ink-extra-muted">
          {detail()}
        </span>
      )}
    </Show>
  </button>
);

/** The finished answer, quoted as if the agent had replied inline. */
const AnswerBody: Component<{ markdown: string }> = (props) => (
  <div class="w-full min-w-0 border-l-2 border-accent pl-3 text-left text-sm leading-6">
    <StaticMarkdownContext theme={channelTheme}>
      <StaticMarkdown markdown={props.markdown} target="external" />
    </StaticMarkdownContext>
  </div>
);

/** Closes the settled chip where the activity line sat while the turn ran. */
const OpenSessionLink: Component<{ onOpen?: () => void }> = (props) => (
  <button
    type="button"
    class="mb-2 flex h-6 items-center text-xs text-ink-extra-muted hover:text-ink"
    onMouseDown={(event) => event.preventDefault()}
    onClick={props.onOpen}
    disabled={!props.onOpen}
  >
    Open session
  </button>
);

/**
 * Render an already-derived Magic Chip presentation.
 *
 * A running turn is one `h-6` row and stays that height from the first event
 * to the last, however much the agent narrates in between — the message below
 * never moves while the agent works. Reaching the answer is the single moment
 * the chip grows.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  onOpen?: () => void;
}> = (props) => {
  // A settled turn is the only one with prose; an unsettled one is the only
  // one guaranteed an activity. The footer takes whichever it gets.
  const markdown = () =>
    props.presentation.kind === 'settled'
      ? props.presentation.markdown
      : undefined;
  const activity = () => props.presentation.activity;

  return (
    <div
      class="grid w-full min-w-0 justify-items-start gap-1"
      data-magic-chip={props.agentSessionId}
    >
      <Show when={markdown()}>
        {(markdown) => <AnswerBody markdown={markdown()} />}
      </Show>
      <div class="w-full min-w-0 pl-3">
        <Show
          when={activity()}
          fallback={<OpenSessionLink onOpen={props.onOpen} />}
        >
          {(activity) => (
            <ActivityLine activity={activity()} onOpen={props.onOpen} />
          )}
        </Show>
      </div>
    </div>
  );
};
