import PencilSimple from '@icon/system/regular/pencil-simple.svg';

/**
 * A saved reply shown under the message it answers, where touch devices have
 * no inline composer. Tapping it reopens the draft.
 */
export function DraftReplyPreview(props: { text: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full min-h-11 items-center gap-2 py-2 text-left text-sm"
      onClick={() => props.onOpen()}
    >
      <span class="shrink-0 font-medium text-warning">Draft</span>
      <span class="ph-no-capture min-w-0 flex-1 truncate text-ink-muted">
        {props.text || 'No text yet'}
      </span>
      <PencilSimple class="size-4 shrink-0 text-ink-extra-muted" />
    </button>
  );
}
