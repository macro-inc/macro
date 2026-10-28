import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import Reply from '@phosphor/arrow-bend-up-left.svg';
import LinkIcon from '@phosphor/link.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { WorkspaceComment } from '../../../core/dummy-workspace';
import { homepagePeople } from '../../../core/homepage-demo-people';
import { DemoMentionText } from '../../DemoMention';

const QUICK_REACTIONS = ['❤️', '👍', '😂'] as const;

// Presentation from channel/Message/Layout, SenderName, Timestamp, Content
// and ActionMenu. The toolbar keeps the app's groups and labels and, like the
// app, appears on hover or focus. `hovered` lets a walkthrough show it.
export function MessageRow(props: {
  message: WorkspaceComment;
  children?: JSX.Element;
  /** The same message body with interactive, locally resolved mention chips. */
  bodyContent?: JSX.Element;
  hovered?: boolean;
  onReply?: () => void;
  onTask?: () => void;
  onReact?: (emoji?: string) => void;
  onChat?: () => void;
}) {
  let row!: HTMLElement;
  const [dismissed, setDismissed] = createSignal(false);
  const reactions = () =>
    props.message.emojiReactions ??
    (props.message.reactions?.length
      ? [{ emoji: '👍', users: props.message.reactions }]
      : []);
  const react = (emoji: string, event: MouseEvent) => {
    props.onReact?.(emoji);
    if (event.detail === 0) row.focus({ preventScroll: true });
    else (event.currentTarget as HTMLButtonElement).blur();
    setDismissed(true);
  };
  const hasActions = () =>
    !!(props.onReact || props.onTask || props.onReply || props.onChat);
  return (
    <article
      ref={row}
      tabIndex={-1}
      data-actions-dismissed={dismissed()}
      onPointerLeave={() => setDismissed(false)}
      onPointerEnter={() => setDismissed(false)}
      onFocusOut={(event) => {
        if (!row.contains(event.relatedTarget as Node | null))
          setDismissed(false);
      }}
      class="sample-message-row"
      data-reply={!!props.message.replyTo}
      data-hovered={props.hovered ? 'true' : undefined}
    >
      <Show
        when={
          props.message.person === 'claude' || props.message.person === 'cursor'
        }
        fallback={
          <img
            src={homepagePeople[props.message.person].photo}
            alt=""
            class="size-8 rounded-full object-cover"
          />
        }
      >
        <span class="sample-agent-avatar" data-agent={props.message.person}>
          <Show
            when={props.message.person === 'claude'}
            fallback={<CursorIcon />}
          >
            <ClaudeIcon />
          </Show>
        </span>
      </Show>
      <div class="min-w-0">
        <div class="flex items-baseline gap-1.5">
          <span class="text-sm font-medium">
            {homepagePeople[props.message.person].name}
          </span>
          <Show
            when={
              props.message.person === 'claude' ||
              props.message.person === 'cursor' ||
              props.message.person === 'macro'
            }
          >
            <span class="sample-agent-badge">Agent</span>
          </Show>
          <Show when={props.message.time}>
            <span class="text-xs text-ink-extra-muted tabular-nums">
              {props.message.time}
            </span>
          </Show>
        </div>
        <Show
          when={props.bodyContent}
          fallback={
            <p class="mt-1 text-base whitespace-pre-wrap break-words">
              <DemoMentionText text={props.message.body} />
            </p>
          }
        >
          {props.bodyContent}
        </Show>
        {props.children}
        <For each={reactions()}>
          {(reaction) => (
            <button
              class="sample-reaction"
              type="button"
              aria-label={`${reaction.emoji} ${reaction.users.length}`}
              aria-pressed={reaction.users.includes('jacob')}
              onClick={(event) => react(reaction.emoji, event)}
            >
              {reaction.emoji} {reaction.users.length}
            </button>
          )}
        </For>
      </div>
      <Show when={hasActions()}>
        <div class="sample-message-actions" role="toolbar">
          <Show when={props.onReact}>
            <For each={QUICK_REACTIONS}>
              {(emoji) => (
                <button
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={(event) => react(emoji, event)}
                >
                  <span class="text-base leading-none">{emoji}</span>
                </button>
              )}
            </For>
            <span class="sample-message-actions-divider" />
          </Show>
          <Show when={props.onTask}>
            <button
              type="button"
              aria-label="Task"
              title="Task"
              onClick={props.onTask}
            >
              <ListChecks class="size-4" />
            </button>
          </Show>
          <Show when={props.onChat}>
            <button
              type="button"
              aria-label="Chat with Agent"
              title="Chat with Agent"
              onClick={props.onChat}
            >
              <Sparkle class="size-4" />
            </button>
          </Show>
          <Show when={props.onTask || props.onChat}>
            <span class="sample-message-actions-divider" />
          </Show>
          <Show when={props.onReply}>
            <button
              type="button"
              aria-label="Reply"
              title="Reply"
              onClick={props.onReply}
            >
              <Reply class="size-4" />
            </button>
          </Show>
          <button type="button" aria-label="Copy Link" title="Copy Link">
            <LinkIcon class="size-4" />
          </button>
        </div>
      </Show>
    </article>
  );
}
