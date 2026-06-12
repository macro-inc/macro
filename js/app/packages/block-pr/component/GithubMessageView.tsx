import { Message } from '@channel/Message/Message';
import type { MessageData } from '@channel/Message/types';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';

import { githubAvatarUrl, githubDisplayLogin } from '../util/githubMarkdown';

/** Collapsed preview height for long comments (px). */
const PREVIEW_MAX_HEIGHT = 240;

function sourceLabel(source: string): string | null {
  switch (source) {
    case 'review':
      return 'review';
    case 'review_comment':
      return 'on diff';
    default:
      return null;
  }
}

/**
 * Fudge a GitHub comment into the channel message shape: GitHub authors ride
 * the bot-sender path, which carries an explicit display name and avatar URL
 * through `Message.SenderIcon`/`Message.SenderName`.
 */
function toMessageData(comment: GithubPullRequestComment): MessageData {
  const login = comment.authorLogin ?? 'github';
  return {
    id: `github-${comment.id}`,
    content: comment.body,
    sender_id: `bot|github:${login}`,
    sender: {
      type: 'bot',
      id: `github:${login}`,
      name: githubDisplayLogin(login),
      avatar_url: githubAvatarUrl(login),
    },
    created_at: comment.createdAt ?? '',
    updated_at: comment.updatedAt ?? comment.createdAt ?? '',
    deleted_at: null,
    edited_at: null,
    attachments: [],
    reactions: [],
  };
}

/**
 * A read-only GitHub comment rendered with the channel message components,
 * collapsed to a preview when long (bot comments tend to be walls of text).
 */
export function GithubMessageView(props: {
  comment: GithubPullRequestComment;
}) {
  const messageData = () => toMessageData(props.comment);

  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let contentRef: HTMLDivElement | undefined;

  onMount(() => {
    // The markdown renders asynchronously — track its real height.
    createResizeObserver(
      () => contentRef,
      () => {
        if (!contentRef) return;
        setOverflowing(contentRef.scrollHeight > PREVIEW_MAX_HEIGHT + 60);
      }
    );
  });

  return (
    <Message.Root message={messageData()}>
      <Message.Layout class="pt-(--regular-message-padding-t)">
        <Message.Slot placement="icon">
          <Message.SenderIcon />
        </Message.Slot>
        <Message.Slot
          placement="header"
          class="flex items-center gap-1 min-w-0 w-full"
        >
          <Message.SenderName />
          <Show when={sourceLabel(props.comment.source)}>
            {(label) => (
              <span class="px-1.5 py-px rounded-full border border-edge-muted text-[10px] text-ink-placeholder shrink-0">
                {label()}
              </span>
            )}
          </Show>
          <div class="grow shrink-0 min-w-0 flex items-center gap-1.5 justify-end">
            <Message.Timestamp class="ml-auto shrink-0" format="dateAndTime" />
            <Show when={props.comment.url}>
              {(url) => (
                <a
                  href={url()}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on GitHub"
                  class="shrink-0 text-ink-placeholder hover:opacity-70 transition-opacity"
                >
                  <ArrowSquareOut class="size-3" />
                </a>
              )}
            </Show>
          </div>
        </Message.Slot>
        <Message.Slot placement="content" class="ph-no-capture">
          <div
            ref={contentRef}
            class={cn('relative', !expanded() && 'overflow-hidden')}
            style={
              !expanded() && overflowing()
                ? { 'max-height': `${PREVIEW_MAX_HEIGHT}px` }
                : undefined
            }
          >
            <Message.Content class="overflow-x-auto" />
            <Show when={!expanded() && overflowing()}>
              <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-panel to-transparent pointer-events-none" />
            </Show>
          </div>
          <Show when={overflowing()}>
            <button
              type="button"
              class="mt-1 text-xs text-accent hover:opacity-70 transition-opacity"
              onClick={() => setExpanded(!expanded())}
            >
              {expanded() ? 'Show less' : 'Show more'}
            </button>
          </Show>
        </Message.Slot>
      </Message.Layout>
    </Message.Root>
  );
}
