import type { DocComment } from '@core/docx-engine/types';
import { For, Show } from 'solid-js';

/** A comment date as the card shows it (the stored text when unparsable). */
function shownDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

/**
 * A comment the document itself carries (written in Word), with its
 * replies: read-only, beside the text it is on.
 */
export function DocxWordCommentCard(props: {
  comment: DocComment;
  replies: DocComment[];
}) {
  return (
    <div
      class="pointer-events-auto rounded-xl border border-edge bg-surface p-2 text-sm shadow-md shadow-drop-shadow"
      data-docx-word-comment={props.comment.id}
    >
      <For each={[props.comment, ...props.replies]}>
        {(comment, index) => (
          <div
            class="flex flex-col gap-0.5 px-1 py-1"
            classList={{ 'border-t border-edge-muted': index() > 0 }}
          >
            <div class="flex items-baseline gap-2">
              <span class="truncate font-medium text-ink">
                {comment.author || 'Unknown author'}
              </span>
              <Show when={comment.date}>
                {(date) => (
                  <span class="shrink-0 text-xs text-ink-muted">
                    {shownDate(date())}
                  </span>
                )}
              </Show>
            </div>
            <p class="whitespace-pre-wrap break-words text-ink">
              {comment.text}
            </p>
          </div>
        )}
      </For>
      <div class="px-1 pt-1 text-xs text-ink-extra-muted">
        {props.comment.done ? 'In the document · Resolved' : 'In the document'}
      </div>
    </div>
  );
}
