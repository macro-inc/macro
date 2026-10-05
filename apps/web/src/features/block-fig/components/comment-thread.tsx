/**
 * One comment thread: its comments with their authors and times, mentions
 * highlighted, Resolve or Reopen, Delete, and a reply box.
 */

import CheckCircle from '@phosphor/check-circle.svg';
import Trash from '@phosphor/trash.svg';
import { For, Show } from 'solid-js';
import {
  type FigComment,
  type FigCommentThread,
  type FigPerson,
  initialsOf,
  mentionParts,
  relativeTime,
} from '../core/comments';
import { CommentComposer } from './comment-composer';

export function CommentAvatar(props: { person: FigPerson }) {
  return (
    <span
      class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-bg font-medium text-[10px] text-accent"
      title={props.person.name}
    >
      {initialsOf(props.person.name)}
    </span>
  );
}

export function CommentText(props: { comment: FigComment }) {
  return (
    <p class="whitespace-pre-wrap break-words text-ink text-xs">
      <For each={mentionParts(props.comment.text, props.comment.mentions)}>
        {(part) =>
          part.mention ? (
            <span
              class="font-medium text-accent"
              data-testid="fig-comment-mention"
            >
              {part.text}
            </span>
          ) : (
            part.text
          )
        }
      </For>
    </p>
  );
}

function CommentItem(props: { comment: FigComment; now: number }) {
  return (
    <div class="flex gap-2" data-testid="fig-comment-item">
      <CommentAvatar person={props.comment.author} />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1.5">
          <span class="truncate font-medium text-ink text-xs">
            {props.comment.author.name}
          </span>
          <span class="shrink-0 text-[11px] text-ink-muted">
            {relativeTime(props.comment.createdAt, props.now)}
          </span>
        </div>
        <CommentText comment={props.comment} />
      </div>
    </div>
  );
}

export function CommentThreadView(props: {
  thread: FigCommentThread;
  canComment: boolean;
  /** Whether this person may delete the thread (its author). */
  canDelete: boolean;
  people: (query: string) => FigPerson[];
  onReply: (text: string, mentions: FigPerson[]) => Promise<unknown>;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  /** Escape in the reply box. */
  onClose?: () => void;
}) {
  const now = Date.now();
  return (
    <div
      class="flex flex-col gap-3"
      data-testid="fig-comment-thread"
      data-thread={props.thread.id}
      data-resolved={props.thread.resolved ? 'true' : 'false'}
    >
      <div class="flex items-center gap-1">
        <Show when={props.thread.resolved}>
          <span class="text-[11px] text-ink-muted">Resolved</span>
        </Show>
        <div class="ml-auto flex items-center gap-0.5">
          <Show when={props.canComment}>
            <button
              type="button"
              class="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
              data-testid={
                props.thread.resolved
                  ? 'fig-comment-reopen'
                  : 'fig-comment-resolve'
              }
              onClick={() => props.onResolve(!props.thread.resolved)}
            >
              <CheckCircle class="size-3.5" />
              {props.thread.resolved ? 'Reopen' : 'Resolve'}
            </button>
          </Show>
          <Show when={props.canDelete}>
            <button
              type="button"
              class="rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
              aria-label="Delete thread"
              data-testid="fig-comment-delete"
              onClick={() => props.onDelete()}
            >
              <Trash class="size-3.5" />
            </button>
          </Show>
        </div>
      </div>
      <For each={props.thread.comments}>
        {(c) => <CommentItem comment={c} now={now} />}
      </For>
      <Show when={props.canComment}>
        <CommentComposer
          placeholder="Reply"
          testId="fig-comment-reply"
          submitLabel="Reply"
          people={props.people}
          onSubmit={props.onReply}
          onEscape={props.onClose}
        />
      </Show>
    </div>
  );
}
