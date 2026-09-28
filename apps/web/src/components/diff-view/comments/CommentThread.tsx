/**
 * The parts of a GitHub-style review thread under a diff line: a card, each
 * comment with its author, a reply button, and the editor for a new one.
 * Presentational; `createDiffComments` places them and holds the draft.
 */

import { Avatar, Button } from '@ui';
import { type JSX, onMount, Show } from 'solid-js';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Root(props: { children: JSX.Element }) {
  return (
    <div class="px-3 py-2">
      <div class="flex flex-col gap-3 rounded-xl border border-edge-muted bg-surface p-3 transition focus-within:border-edge">
        {props.children}
      </div>
    </div>
  );
}

function Comment(props: {
  author: string;
  avatarUrl?: string;
  /** When it was written, already formatted. */
  time?: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex gap-2">
      <Avatar size="md">
        <Show when={props.avatarUrl}>
          {(url) => <Avatar.Image src={url()} alt="" />}
        </Show>
        <Avatar.Fallback>{initials(props.author)}</Avatar.Fallback>
      </Avatar>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium text-ink">{props.author}</span>
          <Show when={props.time}>
            <span class="text-xs text-ink-subtle">{props.time}</span>
          </Show>
        </div>
        <div class="text-sm wrap-break-word whitespace-pre-wrap text-ink-muted">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function Reply(props: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      class="self-start"
      onClick={() => props.onClick()}
    >
      Reply
    </Button>
  );
}

/** A controlled editor: the text lives with the draft, not in here. */
function Composer(props: {
  value: string;
  onInput: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  placeholder?: string;
  /** Explains where the comment goes, beside the buttons. */
  hint?: string;
}) {
  let textarea!: HTMLTextAreaElement;
  onMount(() => textarea.focus());
  const empty = () => props.value.trim() === '';
  return (
    <div class="flex flex-col gap-2">
      <textarea
        ref={textarea}
        class="min-h-16 w-full resize-y rounded-lg border border-edge bg-input px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-input-focus"
        placeholder={props.placeholder ?? 'Leave a comment'}
        aria-label={props.placeholder ?? 'Comment'}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          } else if (
            event.key === 'Enter' &&
            (event.metaKey || event.ctrlKey) &&
            !empty()
          ) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
      />
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate text-xs text-ink-subtle">
          {props.hint}
        </span>
        <Button variant="ghost" size="sm" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button
          variant="cta"
          size="sm"
          disabled={empty()}
          onClick={() => props.onSubmit()}
        >
          {props.submitLabel}
        </Button>
      </div>
    </div>
  );
}

export const CommentThread = { Root, Comment, Reply, Composer };
