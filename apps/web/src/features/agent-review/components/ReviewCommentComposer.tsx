import clickOutside from '@core/directive/clickOutside';
import { Button, ComposerSurface, SendButton } from '@ui';
import { onMount } from 'solid-js';

false && clickOutside;

export function ReviewCommentComposer(props: {
  draft: string;
  readOnly?: boolean;
  sending?: boolean;
  locked?: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  let textarea!: HTMLTextAreaElement;
  const empty = () => !props.draft.trim();
  const label = () => (props.locked ? 'Retry comment' : 'Comment');
  onMount(() => {
    // A virtualized thread can remount while the user is typing in search.
    // Only take focus when another editor does not already own it.
    if (
      !document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]'
      )
    )
      textarea.focus({ preventScroll: true });
  });
  return (
    <ComposerSurface
      as="div"
      class="my-1 rounded-2xl bg-composer text-composer-ink"
    >
      <form
        class="flex flex-col gap-2 p-3"
        use:clickOutside={() => {
          if (empty() && !props.sending && !props.locked) props.onCancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSend();
        }}
      >
        <textarea
          ref={textarea}
          rows={2}
          aria-label="Comment on this code"
          class="block min-h-12 max-h-40 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-composer-placeholder [field-sizing:content]"
          placeholder="Comment on this code…"
          readOnly={props.readOnly || props.sending || props.locked}
          value={props.draft}
          onInput={(event) => props.onDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.isComposing) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              props.onSend();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              props.onCancel();
            }
          }}
        />
        <div class="flex items-center justify-end gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={props.sending}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <SendButton
            type="submit"
            appearance="composer"
            aria-label={label()}
            tooltip={`${label()} (⌘/Ctrl+Enter)`}
            pending={props.sending}
            disabled={props.readOnly || empty() || props.sending}
          />
        </div>
      </form>
    </ComposerSurface>
  );
}
