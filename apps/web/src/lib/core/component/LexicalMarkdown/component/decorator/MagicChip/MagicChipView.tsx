import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import ArrowsIn from '@phosphor/arrows-in.svg';
import Check from '@phosphor/check.svg';
import { Button, Layer } from '@ui';
import { type Component, createMemo, Show } from 'solid-js';
import { MagicChipPullRequest } from './MagicChipPullRequest';
import {
  type MagicChipActivity,
  type MagicChipHeader,
  type MagicChipPresentation,
  type MagicChipTone,
  presentationLine,
  presentationStatus,
  presentationTone,
} from './presentation';

const CONTROL = 'button, select, a, label, [role="button"]';

/**
 * A press on one of the card's own controls is that control's, not a toggle
 * of the card (which is itself a button, so the search stops at it).
 */
function isControl(target: EventTarget | null, area: Element) {
  if (!(target instanceof Element) || target === area) return false;
  const control = target.closest(CONTROL);
  return control !== null && control !== area && area.contains(control);
}

const TONE_DOT: Record<MagicChipTone, string> = {
  busy: 'bg-accent',
  asking: 'bg-amber',
  done: 'bg-green',
};

/**
 * The state at the head of the status row: a small dot that pulses while the
 * turn is doing something, goes amber when it has stopped to ask, and
 * becomes a green check once the turn is over.
 */
const StatusDot: Component<{ tone: MagicChipTone; busy: boolean }> = (
  props
) => (
  <Show
    when={props.tone === 'done'}
    fallback={
      <span
        class="size-2 shrink-0 rounded-full"
        classList={{
          [TONE_DOT[props.tone]]: true,
          'animate-pulse motion-reduce:animate-none': props.busy,
        }}
        data-magic-chip-dot={props.tone}
        aria-hidden="true"
      />
    }
  >
    <span
      class="grid size-3.5 shrink-0 place-items-center rounded-full bg-green text-surface"
      data-magic-chip-dot="done"
      aria-hidden="true"
    >
      <Check class="size-2.5" />
    </span>
  </Show>
);

/** The shimmering label plus its monospaced detail. */
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
            class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-extra-muted"
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
 * The card's status row: who is answering, what the turn is doing, and the
 * way into the session. Sits a surface above the card so it reads as the
 * card's own chrome.
 */
const StatusRow: Component<{
  header?: MagicChipHeader;
  status: MagicChipActivity;
  tone: MagicChipTone;
  /** The reply preview, while the output row has nothing to offer. */
  preview?: string;
  onOpen?: () => void;
  onCollapse?: () => void;
}> = (props) => (
  <Layer offset={1}>
    <div
      class="flex h-7 items-center gap-2 border-b border-edge-muted bg-surface pr-1 pl-2.5 text-xs leading-5 text-ink-muted"
      data-magic-chip-header
    >
      <StatusDot tone={props.tone} busy={props.status.busy} />
      <span
        class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
        data-message-reply-preview={props.preview}
      >
        <Show when={props.header?.agent}>
          {(agent) => (
            <>
              <span
                class="shrink-0 font-semibold text-ink"
                title={props.header?.model}
                data-magic-chip-agent
              >
                {agent()}
              </span>
              <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
                ·
              </span>
            </>
          )}
        </Show>
        <ActivityText activity={props.status} />
      </span>
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
      <button
        type="button"
        class="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-edge bg-surface px-2 font-medium text-ink-muted text-xs disabled:opacity-50"
        classList={{ 'hover:bg-active hover:text-ink': Boolean(props.onOpen) }}
        disabled={!props.onOpen}
        onClick={props.onOpen}
      >
        View session
        <ArrowUpRight class="size-3" />
      </button>
    </div>
  </Layer>
);

/**
 * One compact card for the whole turn: a status row naming the persona,
 * what the turn is doing, and the way into the session, over a single line
 * of the agent's latest prose with the pull request the session opened
 * beside it. The card is one control: anywhere on it opens the session,
 * which is where the passage whole, and any question the agent has stopped
 * to ask, are read and answered.
 */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  header?: MagicChipHeader;
  onOpen?: () => void;
  onCollapse?: () => void;
}> = (props) => {
  const status = createMemo(() => presentationStatus(props.presentation));
  const tone = createMemo(() => presentationTone(props.presentation));
  const line = createMemo(() => presentationLine(props.presentation));

  // While the output row has no prose, a reply to the message previews the
  // status row's line instead.
  const preview = () => {
    if (line()) return undefined;
    const current = status();
    const activity = `${current.label}${current.detail ? ` ${current.detail}` : ''}`;
    const agent = props.header?.agent;
    return agent ? `${agent} · ${activity}` : activity;
  };

  const onCardClick = (event: MouseEvent & { currentTarget: Element }) => {
    if (isControl(event.target, event.currentTarget)) return;
    props.onOpen?.();
  };

  return (
    <Layer depth={2}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Open agent session"
        class="my-2 flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-md border border-edge-muted bg-surface text-left hover:border-edge"
        classList={{ 'cursor-pointer': Boolean(props.onOpen) }}
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        data-lexical-interactive
        onClick={(event) => {
          event.stopPropagation();
          onCardClick(event);
        }}
        on:mousedown={(event) => {
          // The chip sits in a Lexical message; a press must not move the
          // editor's selection.
          event.preventDefault();
        }}
        on:keydown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          props.onOpen?.();
        }}
      >
        <StatusRow
          header={props.header}
          status={status()}
          tone={tone()}
          preview={preview()}
          onOpen={props.onOpen}
          onCollapse={props.onCollapse}
        />
        <div
          class="flex h-8 min-w-0 items-center gap-2 pr-2.5 pl-2.5 text-ink text-sm leading-5"
          data-magic-chip-answer
        >
          <span class="min-w-0 flex-1 truncate" data-magic-chip-line>
            <Show
              when={line()}
              fallback={
                <span class="text-ink-subtle italic">Nothing written yet</span>
              }
            >
              {(text) => <>{text()}</>}
            </Show>
          </span>
          <Show when={props.header?.pullRequestUrl}>
            {(url) => (
              <div
                class="flex h-6 min-w-0 max-w-[45%] shrink-0 items-center overflow-hidden rounded-full border border-edge-muted bg-surface px-1 text-xs"
                data-magic-chip-pull-request-slot
              >
                <MagicChipPullRequest url={url()} />
              </div>
            )}
          </Show>
        </div>
      </div>
    </Layer>
  );
};
