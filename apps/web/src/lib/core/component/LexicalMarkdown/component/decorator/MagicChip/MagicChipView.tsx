import {
  LiveQuestion,
  type LiveQuestionRequest,
  type RespondToElicitation,
} from '@app/features/block-agent/component/parts/LiveElicitation';
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
import { PulsingStar } from '@entity/components/PulsingStar';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretRight from '@phosphor/caret-right.svg';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import type {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { Button, Layer } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import type {
  MagicChipActivity,
  MagicChipPresentation,
  MagicChipQuestion,
} from './presentation';

function answerMarkdown(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? undefined : presentation.markdown;
}

function currentActivity(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' || presentation.kind === 'answering'
    ? presentation.activity
    : undefined;
}

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof Element && target.closest('input, textarea') !== null
  );
}

function replyPreview(activity: MagicChipActivity | undefined) {
  if (!activity) return 'Open session';
  return `${activity.label}${activity.detail ? ` ${activity.detail}` : ''}`;
}

/** What the chip's answer to a question does. */
export type MagicChipAnswer = {
  /** An answer is on the wire; the buttons wait. */
  answering: boolean;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

/**
 * A question the agent stopped to ask, answered in the thread: a form's
 * fields, a URL's consent, or a Macro user tool's draft summarized read-only
 * with the two decisions. The same controls the session shows, so the chip
 * offers everything the session would except editing a tool's draft, which
 * needs the tool's composer - `Edit in session` opens it. Anyone but the
 * session's owner sees the question locked and who is being waited on.
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
  // Everything but a recognized user tool goes through the shared controls; a
  // draft the tool's schema rejects falls back to the flat form the agent
  // also sent, as the session does.
  const question = (): LiveQuestionRequest | undefined => {
    const current = request();
    if (current.kind !== 'user_tool') return current;
    return userTool() ? undefined : { kind: 'form', schema: current.schema };
  };
  const locked = () =>
    !props.asking.canAnswer || !props.answer || props.answer.answering;
  const waitingFor = () =>
    props.asking.canAnswer
      ? 'Waiting for you'
      : `Waiting for ${props.asking.ownerName}`;
  const confirmLabel = () =>
    match(userTool()?.tool.name)
      .with('CreateCalendarEvent', () => 'Create event')
      .with('SendEmail', () => 'Send email')
      .otherwise(() => 'Confirm');
  const respond: RespondToElicitation = async (answer) => {
    if (locked()) return false;
    return (await props.answer?.respond(answer)) ?? false;
  };
  // The chip sends the draft as the agent wrote it; edits need the session's
  // composer.
  const accept = () =>
    void respond({
      action: 'accept',
      content: { [DRAFT_FIELD]: JSON.stringify(userTool()?.draft ?? {}) },
    });
  const openSession = (label: string) => (
    <Button
      variant="ghost"
      size="xs"
      disabled={!props.onOpen}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onOpen}
    >
      {label}
    </Button>
  );

  return (
    <div
      class="flex w-full min-w-0 flex-col gap-2 border-t border-edge-muted px-3 py-2.5"
      data-magic-chip={props.agentSessionId}
      data-magic-chip-asking
      data-message-reply-preview={`${waitingFor()} · ${props.asking.question.message}`}
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-semibold text-ink-muted" aria-live="polite">
          {waitingFor()}
        </span>
        <span class="text-sm text-ink wrap-break-word">
          {props.asking.question.message}
        </span>
      </div>
      <Switch>
        <Match when={userTool()}>
          {(reviewed) => (
            <>
              <Switch>
                <Match when={reviewed().tool.name === 'CreateCalendarEvent'}>
                  <EventDraft
                    event={reviewed().tool.data as CreateCalendarEvent}
                  />
                </Match>
                <Match when={reviewed().tool.name === 'SendEmail'}>
                  <EmailDraft
                    email={reviewed().tool.data as SendEmail}
                    inFlight={false}
                  />
                </Match>
              </Switch>
              <div class="flex flex-wrap items-center gap-2">
                <Show when={props.asking.canAnswer}>
                  <Button
                    variant="cta"
                    size="xs"
                    disabled={locked()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={accept}
                  >
                    {confirmLabel()}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={locked()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void respond({ action: 'decline' })}
                  >
                    Cancel
                  </Button>
                </Show>
                <span class="ml-auto">
                  {openSession(
                    props.asking.canAnswer ? 'Edit in session' : 'Open session'
                  )}
                </span>
              </div>
            </>
          )}
        </Match>
        <Match when={question()}>
          {(live) => (
            // Keyed on the request so a new question starts a fresh draft
            // while metadata refreshes of the same one keep what was typed.
            <Show when={String(props.asking.question.requestId)} keyed>
              <LiveQuestion
                request={live()}
                locked={locked()}
                onRespond={respond}
                trailing={openSession('Open session')}
              />
            </Show>
          )}
        </Match>
      </Switch>
    </div>
  );
};

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
 * The answer: clipped to the fixed answer area with a fade while collapsed,
 * whole once expanded.
 */
const AnswerBody: Component<{ markdown: string; expanded: boolean }> = (
  props
) => (
  <div
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
    <Show
      when={props.expanded}
      fallback={
        <>
          <div
            class="pointer-events-none absolute inset-x-0 top-1/2 bottom-0 bg-linear-to-b from-transparent via-surface/80 to-surface group-hover/answer:via-hover/80 group-hover/answer:to-hover"
            data-magic-chip-fade
          />
          <ExpandHint expanded={false} />
        </>
      }
    >
      <ExpandHint expanded />
    </Show>
  </div>
);

/**
 * The disclosure cue: `Show more` over the fade, `Show less` under the text.
 * The collapsed cue steps aside while the area is hovered so it never sits
 * on top of the text the hover is inviting you to read.
 */
const ExpandHint: Component<{ expanded: boolean }> = (props) => (
  <span
    class="pointer-events-none flex items-center gap-1 text-xs text-ink-extra-muted transition-opacity motion-reduce:transition-none"
    classList={{
      'absolute right-0 bottom-0 pb-0.5 group-hover/answer:opacity-0':
        !props.expanded,
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
  /** How the chip answers a question; absent renders it read-only. */
  answer?: MagicChipAnswer;
  onOpen?: () => void;
}> = (props) => {
  const asking = () =>
    props.presentation.kind === 'asking'
      ? props.presentation.asking
      : undefined;
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
        onMouseDown={(event) => {
          // The chip sits in a Lexical message; a press must not move the
          // editor's selection, unless it is landing in one of its own inputs.
          if (!isTextEntry(event.target)) event.preventDefault();
        }}
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
        <Show
          when={asking()}
          fallback={
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
          }
        >
          {(question) => (
            <AskingCard
              agentSessionId={props.agentSessionId}
              asking={question()}
              answer={props.answer}
              onOpen={props.onOpen}
            />
          )}
        </Show>
      </div>
    </Layer>
  );
};
