import {
  createLiveQuestion,
  type LiveQuestion,
  QuestionActions,
  QuestionFields,
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
  untrack,
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

/** A Macro user tool the agent drafted, read back for review. */
type ReviewedTool = { name: string; data: unknown; draft: unknown };

/**
 * The chip's side of a question: the shared live state for a form, URL, or
 * unknown mode, or the draft of a recognized Macro user tool. A draft the
 * tool's schema rejects falls back to the flat form the agent also sent, as
 * the session does.
 */
type ChipQuestion = LiveQuestion | { kind: 'user_tool'; tool: ReviewedTool };

function createChipQuestion(asking: MagicChipQuestion): ChipQuestion {
  const request = asking.question.request;
  if (request.kind !== 'user_tool') return createLiveQuestion(request);
  const call = deserializeToolCall({
    id: asking.question.toolCall ?? String(asking.question.requestId),
    name: request.tool,
    json: request.draft,
  });
  return call.isOk()
    ? {
        kind: 'user_tool',
        tool: {
          name: call.value.name,
          data: call.value.data,
          draft: request.draft,
        },
      }
    : createLiveQuestion({ kind: 'form', schema: request.schema });
}

function reviewedTool(question: ChipQuestion) {
  return question.kind === 'user_tool' ? question.tool : undefined;
}

function liveQuestion(question: ChipQuestion): LiveQuestion | undefined {
  return question.kind === 'user_tool' ? undefined : question;
}

/** What the chip is waiting on, with the state behind its controls. */
type ChipAsking = {
  asking: MagicChipQuestion;
  question: ChipQuestion;
  locked: boolean;
  respond: RespondToElicitation;
};

/**
 * The question: who is being waited on with the way into the session at the
 * top, then the prompt and the fields - a form's choices, a URL and its
 * host, a tool draft summarized read-only - scrolling inside the chip's
 * height. The pane contributes no height of its own, so a long form never
 * grows the card. Beside an answer it takes the right side; when the agent
 * wrote nothing it is the whole card.
 */
const AskingPane: Component<
  ChipAsking & { beside: boolean; onOpen?: () => void }
> = (props) => {
  const waitingFor = () =>
    props.asking.canAnswer
      ? 'Waiting for you'
      : `Waiting for ${props.asking.ownerName}`;
  return (
    <div
      class="relative"
      classList={{
        'w-[45%] min-w-40 max-w-72 shrink-0 border-l border-edge-muted':
          props.beside,
        'min-w-0 flex-1': !props.beside,
      }}
      data-magic-chip-pane
    >
      <div class="absolute inset-0 flex flex-col">
        <div class="flex shrink-0 items-center justify-between gap-2 pr-1.5 pl-3 pt-1">
          <span
            class="min-w-0 truncate text-xs font-semibold text-ink-muted"
            aria-live="polite"
          >
            {waitingFor()}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open in session"
            disabled={!props.onOpen}
            onClick={props.onOpen}
          >
            <ArrowUpRight />
          </Button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
          <span class="text-sm leading-5 text-ink wrap-break-word">
            {props.asking.question.message}
          </span>
          <Switch>
            <Match when={reviewedTool(props.question)}>
              {(tool) => (
                <Switch>
                  <Match when={tool().name === 'CreateCalendarEvent'}>
                    <EventDraft event={tool().data as CreateCalendarEvent} />
                  </Match>
                  <Match when={tool().name === 'SendEmail'}>
                    <EmailDraft
                      email={tool().data as SendEmail}
                      inFlight={false}
                    />
                  </Match>
                </Switch>
              )}
            </Match>
            <Match when={liveQuestion(props.question)}>
              {(question) => (
                <QuestionFields question={question()} locked={props.locked} />
              )}
            </Match>
          </Switch>
        </div>
      </div>
      {/* The pane clips; the fade says there is more below. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-surface to-transparent"
      />
    </div>
  );
};

/**
 * The decisions on the chip's bottom row, in the footer's place: Submit or
 * Open with Decline for a question, Create/Send with Cancel for a tool
 * draft. Anyone but the owner reads who is being waited on instead. The
 * chip sends a tool draft as the agent wrote it; editing it needs the
 * session's composer, which the pane's arrow opens.
 */
const AskingActions: Component<ChipAsking> = (props) => {
  const confirmLabel = (tool: ReviewedTool) =>
    match(tool.name)
      .with('CreateCalendarEvent', () => 'Create event')
      .with('SendEmail', () => 'Send email')
      .otherwise(() => 'Confirm');
  const accept = (tool: ReviewedTool) =>
    void props.respond({
      action: 'accept',
      content: { [DRAFT_FIELD]: JSON.stringify(tool.draft ?? {}) },
    });
  const waitingFor = () =>
    props.asking.canAnswer
      ? 'Waiting for you'
      : `Waiting for ${props.asking.ownerName}`;
  return (
    <div
      class="flex min-h-9 w-full items-center gap-2 border-t border-edge-muted px-3 py-1.5 text-xs leading-5"
      data-magic-chip-asking
      data-message-reply-preview={`${waitingFor()} · ${props.asking.question.message}`}
    >
      <Show
        when={props.asking.canAnswer}
        fallback={
          <span class="min-w-0 truncate text-ink-muted">{waitingFor()}</span>
        }
      >
        <Switch>
          <Match when={reviewedTool(props.question)}>
            {(tool) => (
              <>
                <Button
                  variant="cta"
                  size="xs"
                  disabled={props.locked}
                  onClick={() => accept(tool())}
                >
                  {confirmLabel(tool())}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={props.locked}
                  onClick={() => void props.respond({ action: 'decline' })}
                >
                  Cancel
                </Button>
              </>
            )}
          </Match>
          <Match when={liveQuestion(props.question)}>
            {(question) => (
              <QuestionActions
                question={question()}
                locked={props.locked}
                onRespond={props.respond}
                cancel={false}
              />
            )}
          </Match>
        </Switch>
      </Show>
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
 * Holds the answer's space while the agent is busy writing nothing yet: the
 * chat's own waiting glyph. Once the agent is done (or waiting on the user)
 * with nothing said, the space stays empty rather than showing a still star.
 */
const AnswerPending: Component<{ busy: boolean }> = (props) => (
  <Show when={props.busy}>
    <div
      class="flex h-full items-center justify-center"
      data-magic-chip-pending
      aria-hidden="true"
    >
      <PulsingStar kind="streamIndicator" animate />
    </div>
  </Show>
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

  // One draft per question: keyed on the request id so metadata refreshes of
  // the same question keep what was typed, and a new question starts clean.
  const requestKey = createMemo(() => {
    const current = asking();
    return current ? String(current.question.requestId) : undefined;
  });
  const question = createMemo(() => {
    if (!requestKey()) return undefined;
    return untrack(() => {
      const current = asking();
      return current ? createChipQuestion(current) : undefined;
    });
  });
  const chipAsking = (): ChipAsking | undefined => {
    const current = asking();
    const state = question();
    if (!current || !state) return undefined;
    const locked =
      !current.canAnswer || !props.answer || props.answer.answering;
    return {
      asking: current,
      question: state,
      locked,
      respond: async (answer) =>
        locked ? false : ((await props.answer?.respond(answer)) ?? false),
    };
  };

  // The agent's side is shown while it has said something, or while there is
  // no question to give the room to; a question with nothing said beside it
  // takes the whole card.
  const showAnswer = () => Boolean(markdown()) || !chipAsking();

  // Before there is an answer there is nothing to expand, so the whole card
  // leads to the session.
  const onAnswerClick = () => {
    if (markdown()) setExpanded((open) => !open);
    else props.onOpen?.();
  };

  return (
    <Layer depth={2}>
      <div
        class="my-2 flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-edge-muted bg-surface"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onMouseDown={(event) => {
          // The chip sits in a Lexical message; a press must not move the
          // editor's selection, unless it is landing in one of its own inputs.
          if (!isTextEntry(event.target)) event.preventDefault();
        }}
      >
        <div class="flex min-h-22">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={markdown() ? expanded() : undefined}
            class="group/answer min-w-0 flex-1 px-3 py-1 text-left hover:bg-hover"
            classList={{ 'h-22': !expanded(), hidden: !showAnswer() }}
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
          <Show when={chipAsking()}>
            {(current) => (
              <AskingPane
                {...current()}
                beside={showAnswer()}
                onOpen={props.onOpen}
              />
            )}
          </Show>
        </div>
        <Show
          when={chipAsking()}
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
          {(current) => <AskingActions {...current()} />}
        </Show>
      </div>
    </Layer>
  );
};
