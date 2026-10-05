/**
 * The Comments pane (Review ▸ Show Comments): the current slide's threads
 * with their replies, a box for a new comment, and each comment's "…" menu
 * (edit, delete, resolve). Resolved threads collapse and grey out until
 * reopened, as in PowerPoint for Microsoft 365.
 */

import type {
  CommentOutline,
  CommentReplyOutline,
} from '@core/pptx-engine/types';
import { Popover } from '@kobalte/core/popover';
import ChatText from '@phosphor/chat-text.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import DotsThree from '@phosphor/dots-three.svg';
import PaperPlaneRight from '@phosphor/paper-plane-right.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { authorHue, initialsOf, relativeTime } from '../core/comments';
import type { CommentsState } from '../primitives/create-comments';
import { PopoverItem } from './ribbon/controls';

/** An author's colored circle with their initials. */
function Avatar(props: { name: string; initials?: string; dim?: boolean }) {
  return (
    <span
      class="flex size-6 shrink-0 select-none items-center justify-center rounded-full font-semibold text-[10px] text-[white]"
      classList={{ 'opacity-60': props.dim }}
      style={{ background: `oklch(0.58 0.13 ${authorHue(props.name)})` }}
      aria-hidden="true"
    >
      {initialsOf(props.name, props.initials)}
    </span>
  );
}

/** A comment's "…" menu. */
function MoreMenu(props: {
  label: string;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={2}
    >
      <Popover.Trigger
        as={Button}
        size="icon-sm"
        variant="ghost"
        label={props.label}
        tooltipPlacement="top"
        data-testid="pptx-comment-menu"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <DotsThree />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu w-48 rounded-xl border border-edge bg-menu p-1 text-ink text-xs shadow-xl outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {props.children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** A text box for writing a comment: Ctrl/Cmd+Enter posts, Escape cancels. */
function CommentBox(props: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  testId: string;
  submitTestId: string;
  autofocus?: boolean;
  /** One line with the send button inside (replies). */
  compact?: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = createSignal(props.initial ?? '');
  let field!: HTMLTextAreaElement;
  onMount(() => {
    if (props.autofocus) queueMicrotask(() => field.focus());
  });
  const submit = async () => {
    const value = text().trim();
    if (!value) return;
    await props.onSubmit(value);
    setText('');
  };
  const send = (
    <Button
      size={props.compact ? 'icon-sm' : 'sm'}
      variant={props.compact ? 'ghost' : 'accent'}
      label={props.submitLabel}
      tooltip={`${props.submitLabel} (Ctrl+Enter)`}
      disabled={!text().trim()}
      data-testid={props.submitTestId}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        void submit();
      }}
    >
      <PaperPlaneRight />
    </Button>
  );
  return (
    <div
      class="flex gap-1"
      classList={{
        'flex-col': !props.compact,
        'items-end rounded-md border border-edge-muted bg-input pr-0.5 focus-within:border-accent':
          !!props.compact,
      }}
    >
      <textarea
        ref={field}
        rows={props.compact ? Math.min(4, text().split('\n').length) : 2}
        value={text()}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        data-testid={props.testId}
        class="w-full resize-none bg-transparent px-2 py-1.5 text-ink text-xs outline-none placeholder:text-ink-placeholder"
        classList={{
          'min-h-12 resize-y rounded-md border border-edge-muted bg-input focus:border-accent':
            !props.compact,
        }}
        onInput={(e) => setText(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            props.onCancel?.();
          }
        }}
      />
      <Show when={!props.compact} fallback={<div class="pb-0.5">{send}</div>}>
        <div class="flex justify-end gap-1">
          <Show when={props.onCancel}>
            <Button
              size="sm"
              variant="ghost"
              data-testid="pptx-comment-cancel"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                props.onCancel?.();
              }}
            >
              Cancel
            </Button>
          </Show>
          {send}
        </div>
      </Show>
    </div>
  );
}

/** Ticks once a minute, so "5 minutes ago" stays true. */
function createNow() {
  const [now, setNow] = createSignal(new Date());
  onMount(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    onCleanup(() => clearInterval(timer));
  });
  return now;
}

/** One comment (a thread's first or a reply): author, time, text, menu. */
function CommentBody(props: {
  comment: CommentOutline | CommentReplyOutline;
  now: Date;
  readonly: boolean;
  dim?: boolean;
  menu: (close: () => void, startEdit: () => void) => JSX.Element;
  onEdit: (text: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = createSignal(false);
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <Avatar
          name={props.comment.author}
          initials={props.comment.initials}
          dim={props.dim}
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <span
            class="truncate font-semibold text-ink text-xs"
            data-testid="pptx-comment-author"
          >
            {props.comment.author}
          </span>
          <span
            class="text-[11px] text-ink-muted"
            data-testid="pptx-comment-time"
            title={
              props.comment.created
                ? new Date(props.comment.created).toLocaleString()
                : undefined
            }
          >
            {relativeTime(props.comment.created, props.now)}
          </span>
        </div>
        <Show when={!props.readonly}>
          <MoreMenu label="More comment actions">
            {(close) => props.menu(close, () => setEditing(true))}
          </MoreMenu>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <p
            class="whitespace-pre-wrap break-words pl-8 text-ink text-xs"
            classList={{ 'text-ink-muted': props.dim }}
            data-testid="pptx-comment-text"
          >
            {props.comment.text}
          </p>
        }
      >
        <div class="pl-8">
          <CommentBox
            placeholder="Edit comment"
            initial={props.comment.text}
            submitLabel="Save"
            testId="pptx-comment-edit-input"
            submitTestId="pptx-comment-save"
            autofocus
            onSubmit={async (text) => {
              await props.onEdit(text);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </Show>
    </div>
  );
}

export function CommentsPane(props: {
  comments: CommentsState;
  slideId: number;
  readonly: boolean;
  onClose: () => void;
}) {
  const c = props.comments;
  const now = createNow();
  const draft = () => {
    const d = c.draft();
    return d && d.slide === props.slideId ? d : undefined;
  };
  let list!: HTMLDivElement;
  // A thread picked on the slide (or by Previous/Next) scrolls into view.
  createEffect(
    on(c.selected, (id) => {
      if (!id) return;
      queueMicrotask(() =>
        list
          ?.querySelector(`[data-comment-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      );
    })
  );

  const Thread = (threadProps: { thread: CommentOutline }) => {
    const t = () => threadProps.thread;
    const active = () => c.selected() === t().id;
    return (
      <article
        class="flex flex-col gap-2 rounded-lg border bg-surface p-2.5"
        classList={{
          'border-accent ring-1 ring-accent': active(),
          'border-edge-muted': !active(),
          'opacity-70': t().resolved,
        }}
        data-testid="pptx-comment-thread"
        data-comment-id={t().id}
        data-resolved={t().resolved || undefined}
        aria-current={active() || undefined}
        aria-label={`Comment by ${t().author}`}
        onClick={() => c.select(t().id)}
      >
        <Show when={t().resolved}>
          <div class="flex items-center gap-1 text-[11px] text-ink-muted">
            <CheckCircle class="size-3.5" />
            Resolved
          </div>
        </Show>
        <CommentBody
          comment={t()}
          now={now()}
          readonly={props.readonly}
          dim={t().resolved}
          onEdit={(text) => c.edit(t().id, text)}
          menu={(close, startEdit) => (
            <>
              <PopoverItem
                label="Edit comment"
                icon={<PencilSimple class="size-3.5" />}
                testId="pptx-comment-edit"
                onClick={() => {
                  close();
                  startEdit();
                }}
              />
              <PopoverItem
                label={t().legacy ? 'Delete comment' : 'Delete thread'}
                icon={<Trash class="size-3.5" />}
                testId="pptx-comment-delete"
                onClick={() => {
                  close();
                  void c.remove(t().id);
                }}
              />
              <Show when={!t().legacy}>
                <PopoverItem
                  label={t().resolved ? 'Reopen thread' : 'Resolve thread'}
                  icon={<CheckCircle class="size-3.5" />}
                  testId={
                    t().resolved
                      ? 'pptx-comment-reopen'
                      : 'pptx-comment-resolve'
                  }
                  onClick={() => {
                    close();
                    void c.resolve(t().id, !t().resolved);
                  }}
                />
              </Show>
            </>
          )}
        />
        {/* Resolved threads stay collapsed until picked. */}
        <Show when={!t().resolved || active()}>
          <For each={t().replies ?? []}>
            {(reply) => (
              <div
                class="border-edge-muted border-l-2 pl-2"
                data-testid="pptx-comment-reply-item"
                data-comment-id={reply.id}
              >
                <CommentBody
                  comment={reply}
                  now={now()}
                  readonly={props.readonly}
                  dim={t().resolved}
                  onEdit={(text) => c.edit(reply.id, text)}
                  menu={(close, startEdit) => (
                    <>
                      <PopoverItem
                        label="Edit comment"
                        icon={<PencilSimple class="size-3.5" />}
                        testId="pptx-comment-edit"
                        onClick={() => {
                          close();
                          startEdit();
                        }}
                      />
                      <PopoverItem
                        label="Delete comment"
                        icon={<Trash class="size-3.5" />}
                        testId="pptx-comment-delete"
                        onClick={() => {
                          close();
                          void c.remove(reply.id);
                        }}
                      />
                    </>
                  )}
                />
              </div>
            )}
          </For>
          <Show when={!props.readonly && !t().legacy && !t().resolved}>
            <CommentBox
              compact
              placeholder="Reply"
              submitLabel="Post reply"
              testId="pptx-comment-reply"
              submitTestId="pptx-comment-reply-post"
              onSubmit={(text) => c.reply(t().id, text)}
            />
          </Show>
        </Show>
        <Show
          when={t().resolved && !active() && (t().replies?.length ?? 0) > 0}
        >
          <span class="pl-8 text-[11px] text-ink-muted">
            {t().replies?.length === 1
              ? '1 reply'
              : `${t().replies?.length} replies`}
          </span>
        </Show>
      </article>
    );
  };

  return (
    <aside
      class="flex w-72 shrink-0 flex-col border-edge-muted border-l bg-panel"
      data-testid="pptx-comments-pane"
      aria-label="Comments"
    >
      <div class="flex h-9 items-center gap-1 border-edge-muted border-b px-3">
        <span class="flex-1 font-semibold text-ink text-sm">Comments</span>
        <Show when={!props.readonly}>
          <Button
            size="sm"
            variant="ghost"
            label="New comment"
            tooltip="New comment (Ctrl+Alt+M)"
            data-testid="pptx-comments-new"
            onClick={() => c.newComment()}
          >
            <ChatText />
            New
          </Button>
        </Show>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <div
        ref={list}
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
        role="list"
        aria-label="Comment threads"
      >
        <Show when={draft()}>
          <article
            class="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-2.5 ring-1 ring-accent"
            data-testid="pptx-comment-draft-card"
          >
            <div class="flex items-center gap-2">
              <Avatar name={c.author().name} initials={c.author().initials} />
              <span class="font-semibold text-ink text-xs">
                {c.author().name}
              </span>
            </div>
            <CommentBox
              placeholder="Start a conversation"
              submitLabel="Post comment"
              testId="pptx-comment-draft"
              submitTestId="pptx-comment-post"
              autofocus
              onSubmit={(text) => c.post(text)}
              onCancel={() => c.cancelDraft()}
            />
          </article>
        </Show>
        <For each={c.threads()}>{(thread) => <Thread thread={thread} />}</For>
        <Show when={c.threads().length === 0 && !draft()}>
          <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-ink-muted text-xs">
            <ChatText class="size-6" />
            <span>There are no comments on this slide.</span>
            <Show when={!props.readonly}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => c.newComment()}
              >
                New comment
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}
