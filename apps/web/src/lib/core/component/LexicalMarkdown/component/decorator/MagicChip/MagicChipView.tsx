import {
  EmailDraft,
  EventDraft,
} from '@app/features/block-agent/component/parts/UserToolCall';
import { DRAFT_FIELD } from '@app/features/block-agent/state/elicitation-review-sink';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import type {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { Button } from '@ui';
import { type Component, createMemo, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  MagicChipActivity,
  MagicChipPresentation,
  MagicChipQuestion,
} from './presentation';

function working(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? presentation : undefined;
}

function answering(presentation: MagicChipPresentation) {
  return presentation.kind === 'answering' ? presentation : undefined;
}

function asking(presentation: MagicChipPresentation) {
  return presentation.kind === 'asking' ? presentation : undefined;
}

function settled(presentation: MagicChipPresentation) {
  return presentation.kind === 'settled' ? presentation : undefined;
}

/** What the chip's answer to a question does. */
export type MagicChipAnswer = {
  /** An answer is on the wire; the buttons wait. */
  answering: boolean;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

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

/** The response, quoted as if the agent had answered inline. */
const AnswerBody: Component<{ markdown: string }> = (props) => (
  <div
    class="w-full border-l-2 border-accent pl-3 text-left text-sm leading-6"
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
    class="grid w-full min-w-0 justify-items-start gap-1"
    data-magic-chip={props.agentSessionId}
  >
    <AnswerBody markdown={props.markdown} />
    <div class="w-full pl-3">
      <ActivityLine
        agentSessionId={props.agentSessionId}
        activity={props.activity}
        onOpen={props.onOpen}
      />
    </div>
  </div>
);

/**
 * A question the agent stopped to ask, kept small for a channel thread: what
 * is being asked, a read-only summary of a user tool's draft, and the two
 * decisions. Editing the draft, or answering a form field by field, happens
 * in the session - "Edit in session" opens it. Anyone but the session's
 * owner sees the summary and who is being waited on.
 */
const AskingCard: Component<{
  agentSessionId: string;
  asking: MagicChipQuestion;
  answer?: MagicChipAnswer;
  onOpen?: () => void;
}> = (props) => {
  const request = () => props.asking.question.request;
  const userTool = createMemo(() => {
    const current = request();
    if (current.kind !== 'user_tool') return undefined;
    const call = deserializeToolCall({
      id:
        props.asking.question.toolCall ??
        String(props.asking.question.requestId),
      name: current.tool,
      json: current.draft,
    });
    return call.isOk() ? { tool: call.value, draft: current.draft } : undefined;
  });
  const locked = () =>
    !props.asking.canAnswer || props.answer?.answering === true;
  const waitingFor = () =>
    props.asking.canAnswer
      ? 'Waiting for you'
      : `Waiting for ${props.asking.ownerName}`;
  const confirmLabel = () =>
    match(userTool()?.tool.name)
      .with('CreateCalendarEvent', () => 'Create event')
      .with('SendEmail', () => 'Send email')
      .otherwise(() => 'Confirm');
  const respond = (answer: ElicitationAnswer) => {
    if (locked()) return;
    void props.answer?.respond(answer);
  };
  // The chip sends the draft as the agent wrote it; edits need the session's
  // composer.
  const accept = () =>
    respond({
      action: 'accept',
      content:
        request().kind === 'user_tool'
          ? { [DRAFT_FIELD]: JSON.stringify(userTool()?.draft ?? {}) }
          : {},
    });

  return (
    <div
      class="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-edge-muted bg-surface p-3"
      data-magic-chip={props.agentSessionId}
      data-magic-chip-asking
      data-message-reply-preview={`${waitingFor()} · ${props.asking.question.message}`}
    >
      <div class="flex items-center gap-2 text-xs">
        <span class="shrink-0 font-semibold text-ink-muted" aria-live="polite">
          {waitingFor()}
        </span>
        <span class="min-w-0 truncate text-ink">
          {props.asking.question.message}
        </span>
      </div>
      <Switch>
        <Match
          when={userTool()?.tool.name === 'CreateCalendarEvent' && userTool()}
        >
          {(reviewed) => (
            <EventDraft event={reviewed().tool.data as CreateCalendarEvent} />
          )}
        </Match>
        <Match when={userTool()?.tool.name === 'SendEmail' && userTool()}>
          {(reviewed) => (
            <EmailDraft
              email={reviewed().tool.data as SendEmail}
              inFlight={false}
            />
          )}
        </Match>
      </Switch>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.asking.canAnswer}>
          <Show when={userTool()}>
            <Button
              variant="cta"
              size="xs"
              disabled={locked()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={accept}
            >
              {confirmLabel()}
            </Button>
          </Show>
          <Button
            variant="outline"
            size="xs"
            disabled={locked()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => respond({ action: 'decline' })}
          >
            {userTool() ? 'Cancel' : 'Decline'}
          </Button>
        </Show>
        <Button
          variant="ghost"
          size="xs"
          disabled={!props.onOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={props.onOpen}
        >
          {props.asking.canAnswer
            ? userTool()
              ? 'Edit in session'
              : 'Answer in session'
            : 'Open session'}
        </Button>
      </div>
    </div>
  );
};

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
  /** How the chip answers a question the agent asks; absent renders one read-only. */
  answer?: MagicChipAnswer;
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
    <Match when={asking(props.presentation)}>
      {(presentation) => (
        <div class="grid w-full min-w-0 justify-items-start gap-1">
          <Show when={presentation().markdown}>
            {(markdown) => <AnswerBody markdown={markdown()} />}
          </Show>
          <AskingCard
            agentSessionId={props.agentSessionId}
            asking={presentation().asking}
            answer={props.answer}
            onOpen={props.onOpen}
          />
        </div>
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
