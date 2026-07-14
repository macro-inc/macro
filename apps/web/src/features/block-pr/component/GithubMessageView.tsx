import { Message } from '@channel/Message/Message';
import type { MessageData } from '@channel/Message/types';
import { Thread } from '@channel/Thread/Thread';
import MacroLogo from '@icon/macro-logo.svg';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
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
  comment: GithubPullRequestComment
): ApiChannelMessage {
  const message = toMessageData(comment);
  const login = comment.authorLogin ?? 'github';
  return {
    ...message,
    channel_id: '',
    sender: {
      type: 'bot',
      id: `github:${login}`,
      name: githubDisplayLogin(login),
      avatar_url: githubAvatarUrl(login),
    },
    thread: {
      reply_count: 0,
      latest_reply_at: null,
      preview: [],
    },
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
  const threadRowMessage = () => toThreadRowMessage(props.comment);
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
    <Thread.Row message={threadRowMessage()}>
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
            <Show when={sourceLabel(props.comment.source)}>
              {(label) => (
                <span class="inline-flex shrink-0 items-center rounded-sm bg-hover px-2 py-0.5 text-xs font-medium leading-none text-ink-muted">
                  {label()}
                </span>
              )}
            </Show>
            <div class="grow shrink-0 min-w-0 flex items-center gap-1.5 justify-end">
              <Message.Timestamp
                class="ml-auto shrink-0"
                format="dateAndTime"
              />
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
    </Thread.Row>
  );
}
