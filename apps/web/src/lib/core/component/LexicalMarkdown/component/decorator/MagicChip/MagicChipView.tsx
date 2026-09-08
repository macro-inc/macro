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
import {
  type MagicChipActivity,
  type MagicChipHeader,
  type MagicChipPresentation,
  type MagicChipQuestion,
  presentationStatus,
} from './presentation';

function answerMarkdown(presentation: MagicChipPresentation) {
  return presentation.kind === 'working' ? undefined : presentation.markdown;
}

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof Element && target.closest('input, textarea') !== null
  );
}

/** What the chip's answer to a question does. */
export type MagicChipAnswer = {
  /** An answer is on the wire; the buttons wait. */
  answering: boolean;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

/** A Macro user tool the agent drafted, awaiting the user's go-ahead. */
type ReviewedTool = { name: string; data: unknown; draft: unknown };

/**
 * The chip's side of a question: the shared live state for a form, URL, or
 * unknown mode, or a recognized Macro user tool's draft. A draft the tool's
 * schema rejects falls back to the flat form the agent also sent, as the
 * session does.
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
 * The decisions for a live question, at the bottom right of the body: Submit
 * or Open with Decline for a question; a Macro user tool's single go-ahead
 * (Create event, Send email), the rest of the review being the session's.
 * The chip sends a tool draft as the agent wrote it.
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
  return (
    <Switch>
      <Match when={reviewedTool(props.question)}>
        {(tool) => (
          <Button
            variant="cta"
            size="xs"
            disabled={props.locked}
            onClick={() => accept(tool())}
          >
            {confirmLabel(tool())}
          </Button>
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
  );
};

/**
 * The chip's top row: who is answering (`@bot · model`), what the turn is
 * doing, and the way into the session. The whole label opens the session,
 * as does the arrow.
 */
const ChipHeader: Component<{
  header?: MagicChipHeader;
  status: MagicChipActivity;
  /** The reply preview, while the answer area has nothing to offer. */
  preview?: string;
  onOpen?: () => void;
}> = (props) => (
  <div
    class="flex min-h-9 items-center gap-1.5 border-b border-edge-muted py-1 pr-1.5 pl-3 text-xs leading-5"
    data-magic-chip-header
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-ink-extra-muted"
      classList={{ 'hover:text-ink': Boolean(props.onOpen) }}
      data-message-reply-preview={props.preview}
      disabled={!props.onOpen}
      onClick={props.onOpen}
    >
      <Show when={props.header?.agent}>
        {(agent) => (
          <span class="shrink-0 font-semibold text-ink">@{agent()}</span>
        )}
      </Show>
      <Show when={props.header?.model}>
        {(model) => (
          <>
            <Show when={props.header?.agent}>
              <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
                ·
              </span>
            </Show>
            <span class="min-w-0 truncate text-ink-muted" title={model()}>
              {model()}
            </span>
          </>
        )}
      </Show>
      <Show when={props.header?.agent || props.header?.model}>
        <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
          ·
        </span>
      </Show>
      <ActivityText activity={props.status} />
    </button>
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
 * The question in the answer area's place: the prompt and what is asked - a
 * form's fields, a URL and its host, a tool draft summarized read-only -
 * scrolling inside the chip's height, with the decisions at the bottom
 * right. Anyone but the owner sees it read-only.
 */
const AskingBody: Component<ChipAsking> = (props) => (
  <div class="flex h-41 min-w-0 flex-col" data-magic-chip-asking>
    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0 flex flex-col gap-2 overflow-y-auto px-3 pt-2 pb-3">
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
      {/* The area clips; the fade says there is more below. */}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-surface to-transparent"
      />
    </div>
    <Show when={props.asking.canAnswer}>
      <div
        class="flex shrink-0 items-center justify-end gap-2 px-3 pb-2"
        data-magic-chip-decisions
      >
        <AskingActions {...props} />
      </div>
    </Show>
  </div>
);

/**
 * One card for the whole turn, at one height: a header naming the bot, its
 * model, and what the turn is doing (with the way into the session), over
 * an area that holds the agent's latest passage - a pulsing star while the
 * agent is busy before it writes, the passage as it streams, and the final
 * passage once the turn ends. Clicking the passage expands it in place. A
 * question the agent stops to ask takes the area instead, its decisions at
 * the bottom right, until it is answered.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  header?: MagicChipHeader;
  /** How the chip answers a question; absent renders it read-only. */
  answer?: MagicChipAnswer;
  onOpen?: () => void;
}> = (props) => {
  const asking = () =>
    props.presentation.kind === 'asking'
      ? props.presentation.asking
      : undefined;
  const markdown = () => answerMarkdown(props.presentation);
  const status = () => presentationStatus(props.presentation);
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
  // While the answer area has no prose, a reply to the message previews the
  // header's line instead.
  const preview = () => {
    const live = asking();
    if (markdown() && !live) return undefined;
    const current = status();
    const line = `${current.label}${current.detail ? ` ${current.detail}` : ''}`;
    return live ? `${line} · ${live.question.message}` : line;
  };

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
        <ChipHeader
          header={props.header}
          status={status()}
          preview={preview()}
          onOpen={props.onOpen}
        />
        {/* The passage stays mounted under a question so its expanded state
            survives the question being answered. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={markdown() ? expanded() : undefined}
          class="group/answer min-w-0 px-3 py-1 text-left hover:bg-hover"
          classList={{ 'h-41': !expanded(), hidden: Boolean(chipAsking()) }}
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
            fallback={<AnswerPending busy={status().busy} />}
          >
            {(answer) => (
              <AnswerBody markdown={answer()} expanded={expanded()} />
            )}
          </Show>
        </div>
        <Show when={chipAsking()}>
          {(current) => <AskingBody {...current()} />}
        </Show>
      </div>
    </Layer>
  );
};
