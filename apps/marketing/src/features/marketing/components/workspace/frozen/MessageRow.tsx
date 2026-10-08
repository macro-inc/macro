import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import Reply from '@phosphor/arrow-bend-up-left.svg';
import LinkIcon from '@phosphor/link.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Smiley from '@phosphor/smiley.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { For, type JSX, Show } from 'solid-js';
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
  hovered?: boolean;
  onReply?: () => void;
  onTask?: () => void;
  onReact?: () => void;
  onChat?: () => void;
}) {
  const hasActions = () =>
    !!(props.onReact || props.onTask || props.onReply || props.onChat);
  return (
    <article
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
          <span class="text-xs text-ink-extra-muted tabular-nums">
            {props.message.time}
          </span>
        </div>
        <p class="mt-1 text-base whitespace-pre-wrap break-words">
          <DemoMentionText text={props.message.body} />
        </p>
        {props.children}
        <Show when={props.message.reactions?.length}>
          <button class="sample-reaction" type="button" onClick={props.onReact}>
            👍 {props.message.reactions?.length}
          </button>
        </Show>
      </div>
      <Show when={hasActions()}>
        <div class="sample-message-actions" role="toolbar">
          <Show when={props.onReact}>
            <For each={QUICK_REACTIONS}>
              {(emoji) => (
                <button
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={props.onReact}
                >
                  <span class="text-base leading-none">{emoji}</span>
                </button>
              )}
            </For>
            <button
              type="button"
              aria-label="More reactions"
              onClick={props.onReact}
            >
              <Smiley class="size-4" />
            </button>
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
