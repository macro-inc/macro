/**
 * Speaker notes for the current slide. Edits are committed when typing
 * pauses and when the field loses focus.
 */

import { createSignal, onCleanup } from 'solid-js';

export function NotesPanel(props: {
  /** Identifies the slide, so a draft never leaks onto another one. */
  slideId: number;
  notes: string;
  readonly: boolean;
  onCommit: (slideId: number, text: string) => void;
}) {
  const [draft, setDraft] = createSignal<{
    slideId: number;
    text: string;
    /** `props.notes` when this draft was committed; unset while typing. */
    base?: string;
  } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const commit = () => {
    clearTimeout(timer);
    const d = draft();
    if (d && d.base === undefined) {
      setDraft({ ...d, base: props.notes });
      props.onCommit(d.slideId, d.text);
    }
  };
  onCleanup(commit);

  const value = () => {
    const d = draft();
    if (!d || d.slideId !== props.slideId) return props.notes;
    // A committed draft shows until the stored notes move on.
    return d.base === undefined || d.base === props.notes
      ? d.text
      : props.notes;
  };

  return (
    <div class="flex h-28 shrink-0 flex-col border-edge-muted border-t bg-panel">
      <label
        class="px-3 pt-1.5 font-medium text-ink-muted text-xs"
        for="pptx-notes"
      >
        Speaker notes
      </label>
      <textarea
        id="pptx-notes"
        data-testid="pptx-notes"
        class="min-h-0 flex-1 resize-none bg-transparent px-3 py-1 text-ink text-sm outline-none placeholder:text-ink-placeholder"
        placeholder={props.readonly ? 'No notes' : 'Click to add notes'}
        readOnly={props.readonly}
        value={value()}
        onInput={(e) => {
          if (draft() && draft()!.slideId !== props.slideId) commit();
          setDraft({ slideId: props.slideId, text: e.currentTarget.value });
          clearTimeout(timer);
          timer = setTimeout(commit, 800);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
