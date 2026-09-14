import {
  createLiveQuestion,
  type DraftedTool,
  type LiveQuestion,
  parseDraftedTool,
  QuestionActions,
  QuestionFields,
  type RespondToElicitation,
  UserToolComposer,
} from '@app/features/block-agent/component/parts/LiveElicitation';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { PulsingStar } from '@entity/components/PulsingStar';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import ArrowsIn from '@phosphor/arrows-in.svg';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
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

const TEXT_ENTRY =
  'input, textarea, [contenteditable]:not([contenteditable="false"])';

const CONTROL = `${TEXT_ENTRY}, button, select, a, label, [role="button"], [role="option"], [role="menuitem"]`;

/**
 * A press on one of the area's own controls is that control's, not a toggle
 * of the area (which is itself a button, so the search stops at it).
 */
function isControl(target: EventTarget | null, area: Element) {
  if (!(target instanceof Element) || target === area) return false;
  const control = target.closest(CONTROL);
  return control !== null && control !== area && area.contains(control);
}

function isTextEntry(target: EventTarget | null) {
  return target instanceof Element && target.closest(TEXT_ENTRY) !== null;
}

/** What the chip's answer to a question does. */
export type MagicChipAnswer = {
  /** An answer is on the wire; the buttons wait. */
  answering: boolean;
  respond: (answer: ElicitationAnswer) => Promise<boolean>;
};

/**
 * The chip's side of a question: the shared live state for a form, URL, or
 * unknown mode, or a Macro user tool's draft for the tool's own composer. A
 * draft the tool's schema rejects falls back to the flat form the agent also
 * sent, as the session does.
 */
type ChipQuestion =
  | LiveQuestion
  | { kind: 'user_tool'; tool: DraftedTool; toolCall: string };

function createChipQuestion(asking: MagicChipQuestion): ChipQuestion {
  const request = asking.question.request;
  if (request.kind !== 'user_tool') return createLiveQuestion(request);
  const toolCall =
    asking.question.toolCall ?? String(asking.question.requestId);
  const tool = parseDraftedTool(request, toolCall);
  return tool
    ? { kind: 'user_tool', tool, toolCall }
    : createLiveQuestion({ kind: 'form', schema: request.schema });
}

function reviewedTool(question: ChipQuestion) {
  return question.kind === 'user_tool' ? question : undefined;
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
 * The decisions for a live question, on the row under the area: the refusal
 * first (`Dismiss` for a tool draft, `Decline` for a question), the go-ahead
 * for a question (`Submit`, `Open`), then the way into the session. A tool
 * draft's go-ahead is its composer's own Send or Create, in the area.
 */
const AskingActions: Component<ChipAsking & { onOpen?: () => void }> = (
  props
) => (
  <>
    <Switch>
      <Match when={reviewedTool(props.question)}>
        <Button
          variant="outline"
          size="xs"
          disabled={props.locked}
          onClick={() => void props.respond({ action: 'decline' })}
        >
          Dismiss
        </Button>
      </Match>
      <Match when={liveQuestion(props.question)}>
        {(question) => (
          <QuestionActions
            question={question()}
            locked={props.locked}
            onRespond={props.respond}
            cancel={false}
            declineFirst
          />
        )}
      </Match>
    </Switch>
    <Button
      variant="ghost"
      size="xs"
      disabled={!props.onOpen}
      onClick={props.onOpen}
    >
      Open in session
    </Button>
  </>
);

/**
 * The chip's top row: who is answering (`Macro Agent · model`), what the turn is
 * doing, and the way into the session. The whole label opens the session,
 * as does the arrow.
 */
const ChipHeader: Component<{
  header?: MagicChipHeader;
  status: MagicChipActivity;
  /** The reply preview, while the answer area has nothing to offer. */
  preview?: string;
  onOpen?: () => void;
  onCollapse?: () => void;
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
          <span class="shrink-0 font-semibold text-ink">{agent()}</span>
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
    <Show when={props.onCollapse}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Collapse to mention"
        tooltip="Collapse to mention"
        on:click={(event) => {
          // Lexical intercepts delegated clicks inside editable decorators.
          event.preventDefault();
          event.stopPropagation();
          props.onCollapse?.();
        }}
      >
        <ArrowsIn />
      </Button>
    </Show>
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

/** The agent's passage, inert so the area's click is the disclosure. */
const Passage: Component<{ markdown: string }> = (props) => (
  <div
    class="pointer-events-none min-w-0 max-w-full wrap-break-word"
    data-message-reply-preview
  >
    <StaticMarkdownContext theme={channelTheme}>
      <StaticMarkdown markdown={props.markdown} target="external" />
    </StaticMarkdownContext>
  </div>
);

/**
 * The question in the passage's place: the prompt and what is asked - a
 * Macro user tool's draft in the tool's own composer, editable in place and
 * sent from there; a form's fields; a URL and its host. Cropped at the
 * chip's height until expanded.
 */
const Question: Component<ChipAsking> = (props) => (
  <div class="flex min-w-0 flex-col gap-2" data-magic-chip-asking>
    <span class="text-sm leading-5 text-ink wrap-break-word">
      {props.asking.question.message}
    </span>
    <Switch>
      <Match when={reviewedTool(props.question)}>
        {(review) => (
          // A press anywhere in the composer is the composer's: its widgets
          // are not all controls the area could recognize, and none may
          // collapse it mid-edit.
          <div onClick={(event) => event.stopPropagation()}>
            <UserToolComposer
              tool={review().tool}
              toolCall={review().toolCall}
              review={{
                canAnswer: () => props.asking.canAnswer,
                answering: () => props.locked && props.asking.canAnswer,
                respond: props.respond,
              }}
            />
          </div>
        )}
      </Match>
      <Match when={liveQuestion(props.question)}>
        {(question) => (
          <QuestionFields question={question()} locked={props.locked} />
        )}
      </Match>
    </Switch>
  </div>
);

/**
 * One card for the whole turn, at one height: a header naming the persona,
 * its model, and what the turn is doing (clicking it opens the session),
 * over an area that holds the agent's latest passage - a pulsing star while
 * the agent is busy before it writes, the passage as it streams, the final
 * passage once the turn ends - or, while the agent waits on a question, the
 * question itself with its decisions on the row beneath. The area is cropped
 * with a fade; clicking it expands it in place, never below the cropped
 * height, so a short passage does not shrink the card.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  header?: MagicChipHeader;
  /** How the chip answers a question; absent renders it read-only. */
  answer?: MagicChipAnswer;
  onOpen?: () => void;
  onCollapse?: () => void;
}> = (props) => {
  // Memoized: read from many places per flush, once per streamed chunk.
  const asking = createMemo(() =>
    props.presentation.kind === 'asking' ? props.presentation.asking : undefined
  );
  const markdown = createMemo(() => answerMarkdown(props.presentation));
  const status = createMemo(() => presentationStatus(props.presentation));
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
  // The question's state, kept through its own teardown: once the answer
  // lands the pending question clears while the composer's effects are still
  // winding down, and a prop getter reading a `<Show>` accessor then would
  // read a stale one. Children key on the request id and read this instead.
  const held = createMemo<ChipAsking | undefined>(
    (previous) => chipAsking() ?? previous,
    undefined
  );
  // There is something to expand once the agent has written, or asked.
  const expandable = () => Boolean(markdown()) || Boolean(chipAsking());
  // While the answer area has no prose, a reply to the message previews the
  // header's line instead.
  const preview = () => {
    const live = asking();
    if (markdown() && !live) return undefined;
    const current = status();
    const line = `${current.label}${current.detail ? ` ${current.detail}` : ''}`;
    return live ? `${line} · ${live.question.message}` : line;
  };

  // Before there is anything to expand, the whole card leads to the session.
  const onAreaClick = (event: MouseEvent & { currentTarget: Element }) => {
    if (isControl(event.target, event.currentTarget)) return;
    if (expandable()) setExpanded((open) => !open);
    else props.onOpen?.();
  };

  return (
    <Layer depth={2}>
      <div
        class="my-2 flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-edge-muted bg-surface"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        data-lexical-interactive
        onClick={(event) => event.stopPropagation()}
        on:mousedown={(event) => {
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
          onCollapse={props.onCollapse}
        />
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expandable() ? expanded() : undefined}
          class="flex min-h-41 min-w-0 flex-col text-left"
          classList={{ 'h-41': !expanded() }}
          data-magic-chip-answer
          onClick={onAreaClick}
          on:keydown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            if (expandable()) setExpanded((open) => !open);
            else props.onOpen?.();
          }}
        >
          <div
            class="relative mx-3 mt-1 mb-1 min-h-0 flex-1"
            classList={{ 'overflow-hidden': !expanded() }}
            data-magic-chip-clip
          >
            <Show
              when={requestKey()}
              keyed
              fallback={
                <Show
                  when={markdown()}
                  fallback={<AnswerPending busy={status().busy} />}
                >
                  {(answer) => <Passage markdown={answer()} />}
                </Show>
              }
            >
              {/* `held` is set whenever a request id is. */}
              <Question {...held()!} />
            </Show>
            {/* Cropped content fades out; expanding shows it whole. */}
            <Show when={expandable() && !expanded()}>
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-surface to-transparent"
                data-magic-chip-fade
              />
            </Show>
          </div>
          <Show when={requestKey() && held()?.asking.canAnswer}>
            <div
              class="flex shrink-0 items-center justify-end gap-2 px-3 pb-2"
              data-magic-chip-decisions
            >
              <AskingActions {...held()!} onOpen={props.onOpen} />
            </div>
          </Show>
        </div>
      </div>
    </Layer>
  );
};
