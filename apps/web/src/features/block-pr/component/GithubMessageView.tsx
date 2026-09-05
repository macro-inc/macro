import { Message } from '@channel/Message/Message';
import type { MessageData } from '@channel/Message/types';
import { Thread } from '@channel/Thread/Thread';
import { ThreadReplyRail } from '@channel/Thread/ThreadReplyRail';
import MacroLogo from '@icon/macro-logo.svg';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';

import { githubAvatarUrl, githubDisplayLogin } from '../util/githubMarkdown';

/** Collapsed preview height for long comments (px). */
const PREVIEW_MAX_HEIGHT = 180;

function GithubAvatarFallback() {
  return (
    <div class="size-full rounded-full bg-surface flex items-center justify-center">
      <MacroLogo class="size-6 text-edge" />
    </div>
  );
}

function GithubAvatar(props: { login: string }) {
  const [failed, setFailed] = createSignal(false);

  return (
    <div class="shrink-0 size-(--user-icon-width)">
      <Show when={!failed()} fallback={<GithubAvatarFallback />}>
        <img
          src={githubAvatarUrl(props.login)}
          alt={githubDisplayLogin(props.login)}
          class="size-full rounded-full bg-surface object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  );
}

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
 * Header badge text: the file/line anchor of a review comment when the
 * metadata carries one, else a generic source label. Falls back to the line
 * the comment was originally left on when later commits outdated it.
 */
function commentBadge(
  comment: GithubPullRequestComment
): { label: string; isAnchor: boolean } | null {
  if (comment.source === 'review_comment' && comment.path) {
    const line = comment.line ?? comment.originalLine;
    return {
      label: line != null ? `${comment.path}:${line}` : comment.path,
      isAnchor: true,
    };
  }
  const label = sourceLabel(comment.source);
  return label === null ? null : { label, isAnchor: false };
}

/**
 * Fudge a GitHub comment into the channel message shape: GitHub authors ride
 * the bot-sender path, which carries an explicit display name through
 * `Message.SenderName`.
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

function toThreadRowMessage(
  comment: GithubPullRequestComment,
  replies: GithubPullRequestComment[]
): ApiChannelMessage {
  const message = toMessageData(comment);
  const login = comment.authorLogin ?? 'github';
  return {
    ...message,
    channel_id: '',
    content: message.content ?? '',
    sender: {
      type: 'bot',
      id: `github:${login}`,
      name: githubDisplayLogin(login),
      avatar_url: githubAvatarUrl(login),
    },
    thread: {
      reply_count: replies.length,
      latest_reply_at: replies.at(-1)?.createdAt ?? null,
      preview: [],
    },
  };
}

/**
 * The message proper: avatar, header, and collapsible markdown body. Replies
 * skip the source pill — the thread rail already marks them as part of the
 * root's review thread.
 */
function GithubCommentMessage(props: {
  comment: GithubPullRequestComment;
  isReply?: boolean;
}) {
  const messageData = () => toMessageData(props.comment);
  const login = () => props.comment.authorLogin ?? 'github';

  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  const truncated = () => !expanded() && overflowing();
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
          <GithubAvatar login={login()} />
        </Message.Slot>
        <Message.Slot
          placement="header"
          class="flex items-center gap-1 min-w-0 w-full"
        >
          <Message.SenderName />
          <Show when={!props.isReply && commentBadge(props.comment)}>
            {(badge) => (
              <span
                class={cn(
                  'inline-flex min-w-0 items-center truncate rounded-sm bg-hover px-2 py-0.5 text-xs font-medium leading-none text-ink-muted',
                  badge().isAnchor && 'font-mono'
                )}
                title={badge().isAnchor ? badge().label : undefined}
              >
                {badge().label}
              </span>
            )}
          </Show>
          <div class="grow shrink-0 min-w-0 flex items-center gap-1.5 justify-end">
            <Message.Timestamp class="ml-auto shrink-0" format="dateAndTime" />
          </div>
        </Message.Slot>
        <Message.Slot placement="content" class="ph-no-capture">
          <div
            ref={contentRef}
            class={cn('relative', truncated() && 'overflow-hidden')}
            style={
              truncated()
                ? {
                    'max-height': `${PREVIEW_MAX_HEIGHT}px`,
                    'mask-image':
                      'linear-gradient(to bottom, black calc(100% - 32px), transparent 100%)',
                    '-webkit-mask-image':
                      'linear-gradient(to bottom, black calc(100% - 32px), transparent 100%)',
                  }
                : undefined
            }
          >
            <Message.Content class="overflow-x-auto" />
          </div>
          <Show when={overflowing()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="mt-2"
              onClick={() => setExpanded(!expanded())}
            >
              {expanded() ? 'Show less' : 'Show more'}
            </Button>
          </Show>
        </Message.Slot>
      </Message.Layout>
    </Message.Root>
  );
}

/**
 * A read-only GitHub comment rendered with the channel message components,
 * collapsed to a preview when long (bot comments tend to be walls of text).
 * Review-thread replies render indented under the root along the thread
 * rail, mirroring Macro discussion threads.
 */
export function GithubMessageView(props: {
  comment: GithubPullRequestComment;
  replies?: GithubPullRequestComment[];
}) {
  const replies = () => props.replies ?? [];

  return (
    <Thread.Row message={toThreadRowMessage(props.comment, replies())}>
      <GithubCommentMessage comment={props.comment} />
      <Show when={replies().length > 0}>
        <div class="relative w-full">
          <Thread.ReplyRailDecorations />
          <Thread.RepliesContainer>
            <Key each={replies()} by="id">
              {(reply) => (
                <div class="relative">
                  <ThreadReplyRail />
                  <GithubCommentMessage comment={reply()} isReply />
                </div>
              )}
            </Key>
          </Thread.RepliesContainer>
        </div>
      </Show>
    </Thread.Row>
  );
}
