import Reply from '@phosphor/arrow-bend-up-left.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { type JSX, Show } from 'solid-js';
import type { WorkspaceComment } from '../../../core/dummy-workspace';
import { homepagePeople } from '../../../core/homepage-demo-people';
import { DemoMentionText } from '../../DemoMention';

// Presentation from channel/Message/Layout, SenderName, Timestamp, Content
// and HoverActions. Callbacks replace the app's channel context and mutations.
export function MessageRow(props: {
  message: WorkspaceComment;
  children?: JSX.Element;
  onReply?: () => void;
  onTask?: () => void;
  onReact?: () => void;
}) {
  return (
    <article class="sample-message-row" data-reply={!!props.message.replyTo}>
      <img
        src={homepagePeople[props.message.person].photo}
        alt=""
        class="size-8 rounded-full object-cover"
      />
      <div class="min-w-0">
        <div class="flex items-baseline gap-1.5">
          <span class="text-sm font-medium">
            {homepagePeople[props.message.person].name}
          </span>
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
      <Show when={props.onReact || props.onTask || props.onReply}>
        <div class="sample-message-actions">
          <Show when={props.onReact}>
            <button
              type="button"
              aria-label="Like message"
              onClick={props.onReact}
            >
              👍
            </button>
          </Show>
          <Show when={props.onReply}>
            <button
              type="button"
              aria-label="Reply to message"
              onClick={props.onReply}
            >
              <Reply class="size-4" />
            </button>
          </Show>
          <Show when={props.onTask}>
            <button
              type="button"
              aria-label="Create task from message"
              onClick={props.onTask}
            >
              <ListChecks class="size-4" />
            </button>
          </Show>
        </div>
      </Show>
    </article>
  );
}
