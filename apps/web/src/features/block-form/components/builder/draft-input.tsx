import {
  type Accessor,
  createRenderEffect,
  createSignal,
  type JSX,
  on,
  splitProps,
} from 'solid-js';

type DraftElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * A commit's answer. Without one (void) a refused commit is assumed to leave
 * the value as it was, so the value shows again; with one, the draft stays
 * shown until the save is answered, and stays (marked) when it is refused.
 */
type Commit = (value: string) => void | PromiseLike<boolean>;

/**
 * The draft behavior both fields share: the DOM value is the draft's home.
 * The field follows the value only while unfocused and holding nothing; a
 * draft sent to be saved is held until the save is answered and the value
 * catches up, and a refused one is held and marked until saved or put back.
 */
function createDraft(options: {
  value: Accessor<string>;
  /** Trim the draft before committing it (names, not prose). */
  trim: boolean;
  /** Whether an empty draft can be committed. */
  allowEmpty: boolean;
  onCommit: Commit;
}) {
  let element: DraftElement | undefined;
  // A committed draft not yet confirmed by the value, or refused.
  let held: string | undefined;
  let saved = false;
  const [refused, setRefused] = createSignal(false);

  const show = (value: string) => {
    if (element) element.value = value;
  };

  createRenderEffect(
    on(options.value, (value) => {
      if (!element || document.activeElement === element) return;
      if (held !== undefined) {
        // Pending or refused: the draft stays. Once saved, the next value is
        // the server's answer and the field follows it.
        if (!saved) return;
        held = undefined;
        saved = false;
      }
      show(value);
    })
  );

  const release = () => {
    held = undefined;
    saved = false;
    setRefused(false);
  };

  async function commit(draft: string) {
    held = draft;
    saved = false;
    setRefused(false);
    try {
      const answer = options.onCommit(draft);
      if (!answer) {
        // No answer to wait for: a refused commit leaves the value as it was.
        release();
        queueMicrotask(() => {
          if (element && document.activeElement !== element)
            show(options.value());
        });
        return;
      }
      const accepted = await answer;
      if (held !== draft) return; // A newer commit or Escape took over.
      if (!accepted) {
        setRefused(true);
        return;
      }
      saved = true;
      if (options.value() === draft) release();
    } catch {
      if (held === draft) setRefused(true);
    }
  }

  return {
    refused,
    ref: (target: DraftElement) => {
      element = target;
      target.value = options.value();
    },
    /** Escape puts the saved value back; `submitOnEnter` blurs to commit. */
    onKeyDown: (event: KeyboardEvent, submitOnEnter: boolean) => {
      if (event.isComposing) return;
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;
      if (submitOnEnter && event.key === 'Enter') {
        event.preventDefault();
        target.blur();
      } else if (event.key === 'Escape') {
        release();
        show(options.value());
        target.blur();
      }
    },
    onBlur: () => {
      if (!element) return;
      const raw = element.value;
      const draft = options.trim ? raw.trim() : raw;
      if (!draft && !options.allowEmpty) {
        // An emptied name is refused: the saved one comes back.
        show(held ?? options.value());
        return;
      }
      if (draft === options.value() && held === undefined) {
        show(draft);
        return;
      }
      if (draft === held && !refused()) return;
      void commit(draft);
    },
  };
}

/**
 * A text input over a value the server may change at any moment. While
 * focused it shows the person's draft, never the value underneath; blur or
 * Enter commits the trimmed draft, Escape puts the value back. An emptied
 * draft is refused and the value comes back.
 */
export function DraftInput(
  props: Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onBlur' | 'onKeyDown' | 'ref'
  > & {
    value: string;
    onCommit: Commit;
  }
) {
  const [local, rest] = splitProps(props, ['value', 'onCommit']);
  const draft = createDraft({
    value: () => local.value,
    trim: true,
    allowEmpty: false,
    onCommit: (value) => local.onCommit(value),
  });
  return (
    <input
      {...rest}
      ref={draft.ref}
      aria-invalid={draft.refused()}
      onKeyDown={(event) => draft.onKeyDown(event, true)}
      onBlur={draft.onBlur}
    />
  );
}

/**
 * The textarea form of `DraftInput`, for prose: the draft is committed as
 * typed (an empty one too) and Enter starts a new line.
 */
export function DraftTextarea(
  props: Omit<
    JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onBlur' | 'onKeyDown' | 'ref'
  > & {
    value: string;
    onCommit: Commit;
  }
) {
  const [local, rest] = splitProps(props, ['value', 'onCommit']);
  const draft = createDraft({
    value: () => local.value,
    trim: false,
    allowEmpty: true,
    onCommit: (value) => local.onCommit(value),
  });
  return (
    <textarea
      {...rest}
      ref={draft.ref}
      aria-invalid={draft.refused()}
      onKeyDown={(event) => draft.onKeyDown(event, false)}
      onBlur={draft.onBlur}
    />
  );
}
