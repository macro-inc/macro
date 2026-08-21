/**
 * Renders one folded agent-session message. Pure composition: each part kind
 * has its own component under `parts/` (the chat block's handler-per-tool
 * split), user prompts get the chat block's bubble treatment, and thoughts
 * shimmer while the turn is in flight.
 */

import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { Button, cn } from '@ui';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { foldedMessageQuoteText, selectedTextIn } from '../state/quote-reply';
import { Thought } from '../ui';
import { ControlPart } from './parts/ControlPart';
import { PermissionPart } from './parts/PermissionPart';
import { PlanPart } from './parts/PlanPart';
import { TextPart } from './parts/TextPart';
import { ToolCallPart } from './parts/ToolCallPart';

const COPIED_MS = 1500;

function AgentMessagePart(props: {
  part: MessagePart;
  /** The turn is still in flight — thoughts read "Thinking" and shimmer. */
  inFlight: boolean;
}): JSX.Element {
  return match(props.part)
    .with({ kind: 'text' }, (part) => <TextPart text={part.text} />)
    .with({ kind: 'thought' }, (part) => (
      <Thought text={part.text} active={props.inFlight} />
    ))
    .with({ kind: 'tool_use' }, (part) => <ToolCallPart part={part} />)
    .with({ kind: 'permission' }, (part) => <PermissionPart part={part} />)
    .with({ kind: 'plan' }, (part) => <PlanPart part={part} />)
    .with({ kind: 'control' }, (part) => <ControlPart part={part} />)
    .exhaustive();
}

/**
 * A prompt, in the chat block's user-bubble treatment
 * (`@core/component/AI/component/message/UserMessage.tsx`): right-aligned,
 * rounded gray surface with a hairline border.
 */
function UserMessage(props: { message: FoldedMessage }) {
  return (
    <div class="flex w-full">
      <div class="relative ml-auto max-w-[calc(100%-8rem)] overflow-hidden rounded-lg border border-edge-muted bg-hover px-3 py-2 text-ink">
        <For each={props.message.parts}>
          {(part) => <AgentMessagePart part={part} inFlight={false} />}
        </For>
      </div>
    </div>
  );
}

/**
 * Quiet hover actions, the ChatGPT/Claude shape: ghost copy (and reply)
 * under the message, no floating bordered chip. Hidden until hover on
 * pointer devices; always visible on touch so copy is still one tap.
 */
function MessageHoverActions(props: {
  align: 'start' | 'end';
  copied: boolean;
  onCopy: () => void;
  onReply?: () => void;
}) {
  return (
    <div
      class={cn(
        'flex h-7 items-center gap-0.5',
        props.align === 'end'
          ? 'ml-auto w-full max-w-[calc(100%-8rem)] justify-end'
          : 'justify-start',
        isTouchDevice()
          ? undefined
          : 'opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100'
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        noTouchResize
        tooltip={props.copied ? 'Copied' : 'Copy'}
        aria-label={props.copied ? 'Copied' : 'Copy'}
        onClick={props.onCopy}
        class="p-1 text-ink-extra-muted hover:text-ink-muted"
      >
        <Show when={!props.copied} fallback={<CheckIcon class="size-3.5" />}>
          <CopyIcon class="size-3.5" />
        </Show>
      </Button>
      <Show when={props.onReply != null}>
        <Button
          variant="ghost"
          size="icon-sm"
          noTouchResize
          tooltip="Reply"
          aria-label="Reply"
          onClick={props.onReply}
          class="p-1 text-ink-extra-muted hover:text-ink-muted"
        >
          <ReplyIcon class="size-3.5" />
        </Button>
      </Show>
    </div>
  );
}

export function Message(props: {
  message: FoldedMessage;
  /** Insert a channel-style quote of this message into the composer. */
  onQuote?: (quotedContent: string) => void;
}) {
  const inFlight = () =>
    props.message.author.kind === 'agent' && props.message.stop == null;

  const quoteText = () => foldedMessageQuoteText(props.message);
  const canCopy = () => quoteText().length > 0;
  const canQuote = () => props.onQuote != null && canCopy();

  const [copied, setCopied] = createSignal(false);
  let copiedTimer: number | undefined;
  onCleanup(() => {
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
  });

  let root: HTMLDivElement | undefined;

  const clipboardText = () => {
    const selected = root ? selectedTextIn(root) : undefined;
    return selected ?? quoteText();
  };

  const quote = () => {
    if (!props.onQuote) return;
    const content = clipboardText();
    if (!content) return;
    props.onQuote(content);
  };

  const copy = async () => {
    const content = clipboardText();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Leave the icon as copy — no toast, same as the chat block.
    }
  };

  return (
    <div ref={root} class="group/message relative">
      <Show
        when={props.message.author.kind === 'user'}
        fallback={
          <div class="flex flex-col gap-1 min-w-0">
            <For each={props.message.parts}>
              {(part) => <AgentMessagePart part={part} inFlight={inFlight()} />}
            </For>
          </div>
        }
      >
        <UserMessage message={props.message} />
      </Show>
      <Show when={canCopy()}>
        <MessageHoverActions
          align={props.message.author.kind === 'user' ? 'end' : 'start'}
          copied={copied()}
          onCopy={() => void copy()}
          onReply={canQuote() ? quote : undefined}
        />
      </Show>
    </div>
  );
}
