import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { cn } from '../utils/classname';

/**
 * Renaming in place, the one behaviour every entity title shares: the draft
 * opens with the whole name selected, Enter and blur commit, Escape restores,
 * an empty or unchanged name is a no-op, a name `validate` refuses keeps the
 * editor open with the reason, and a commit closes the editor at once and
 * shows the new name until the rename settles. A failed rename puts the old
 * name back and says why in a toast.
 */
export type InlineRename<Target> = {
  /** The target being edited, if any. */
  target: Accessor<Target | undefined>;
  draft: Accessor<string>;
  /** Why the draft was refused; the editor stays open while it is set. */
  error: Accessor<string>;
  isRenaming: (target: Target) => boolean;
  /** The target's name, or the name a rename in flight is giving it. */
  displayName: (target: Target) => string;
  begin: (target: Target) => void;
  setDraft: (name: string) => void;
  /** Closes the editor without renaming. */
  cancel: (restoreFocus: boolean) => void;
  /**
   * Commits the draft. Enter passes `restoreFocus`, blur does not, which
   * leaves focus where the user put it. `onSubmit` replaces restoring focus,
   * for editors that hand the keyboard on (a column header to its first cell).
   */
  save: (restoreFocus: boolean, onSubmit?: () => void) => void;
};

export function createInlineRename<Target, Failure>(options: {
  /** Identifies a target across reactive copies of it. */
  key: (target: Target) => string;
  name: (target: Target) => string;
  rename: (target: Target, name: string) => ResultAsync<unknown, Failure>;
  failureMessage: (failure: Failure) => string;
  /** Why a trimmed, changed `name` is refused before it is sent, if it is. */
  validate?: (name: string, target: Target) => string | undefined;
  restoreFocus?: (target: Target) => void;
}): InlineRename<Target> {
  const [target, setTarget] = createSignal<Target>();
  const [draft, setDraft] = createSignal('');
  const [error, setError] = createSignal('');
  // A rename per key at most is in flight; a newer one supersedes it.
  const [saving, setSaving] = createSignal<
    ReadonlyMap<string, { name: string; attempt: symbol }>
  >(new Map());
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const displayName = (current: Target) =>
    saving().get(options.key(current))?.name ?? options.name(current);

  const finish = (restoreFocus: boolean) => {
    const current = target();
    setTarget(undefined);
    setError('');
    if (!restoreFocus || current === undefined || !options.restoreFocus) return;
    const restore = options.restoreFocus;
    queueMicrotask(() => restore(current));
  };

  const settle = (key: string, attempt: symbol) => {
    if (disposed) return;
    setSaving((current) => {
      if (current.get(key)?.attempt !== attempt) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  return {
    target,
    draft,
    error,
    isRenaming: (current) => {
      const editing = target();
      return (
        editing !== undefined && options.key(editing) === options.key(current)
      );
    },
    displayName,
    begin: (next) => {
      setDraft(displayName(next));
      setError('');
      setTarget(() => next);
    },
    setDraft: (name) => {
      setDraft(name);
      setError('');
    },
    cancel: (restoreFocus) => finish(restoreFocus),
    save: (restoreFocus, onSubmit) => {
      const current = target();
      if (current === undefined) return;
      const name = draft().trim();
      const handOff = () => {
        finish(onSubmit ? false : restoreFocus);
        onSubmit?.();
      };
      if (!name || name === displayName(current)) {
        handOff();
        return;
      }

      const refusal = options.validate?.(name, current);
      if (refusal) {
        setError(refusal);
        return;
      }

      const key = options.key(current);
      const attempt = Symbol(key);
      setSaving((saving) => new Map(saving).set(key, { name, attempt }));
      handOff();
      fireAndForget(
        options.rename(current, name).match(
          () => settle(key, attempt),
          (failure) => {
            settle(key, attempt);
            toast.failure(options.failureMessage(failure));
          }
        ),
        'rename'
      );
    },
  };
}

export type RenameInputProps<Target> = {
  rename: InlineRename<Target>;
  'aria-label': string;
  placeholder?: string;
  maxLength?: number;
  /** `fill` takes the width of its container; `content` grows with the name. */
  width?: 'content' | 'fill';
  /** Placement only. */
  class?: string;
  onSubmit?: () => void;
};

/**
 * The text field of an inline rename. It takes the typography of the title it
 * replaces and opens focused with the name selected. Mount it only while
 * `rename.isRenaming(target)`.
 */
export function RenameInput<Target>(
  props: RenameInputProps<Target>
): JSX.Element {
  const errorId = createUniqueId();
  let input: HTMLInputElement | undefined;
  // Enter and Escape give focus back here when the rename restores it nowhere:
  // what had focus when the field opened, unless that was the page or held the
  // field, then the closest focusable element around the field (a row, or the
  // list that owns its keyboard).
  let opener: Element | null = null;
  const returnFocus = () =>
    queueMicrotask(() => {
      if (document.activeElement !== document.body) return;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    });

  onMount(() => {
    if (!input) return;
    const active = document.activeElement;
    // A focused wrapper around the field (a menu trigger round a row) is
    // farther than the row itself.
    const around = active === document.body || active?.contains(input);
    opener = around
      ? (input.parentElement?.closest('[tabindex]') ?? active)
      : active;
    input.focus();
    input.select();
    // Selecting a long name scrolls the field to its end; show its start.
    input.scrollLeft = 0;
  });

  return (
    <span
      class={cn(
        'relative inline-flex min-w-0 max-w-full',
        props.width === 'fill' && 'w-full',
        props.class
      )}
    >
      <input
        ref={input}
        type="text"
        autocomplete="off"
        data-1p-ignore
        aria-label={props['aria-label']}
        aria-invalid={props.rename.error() ? true : undefined}
        aria-describedby={props.rename.error() ? errorId : undefined}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        value={props.rename.draft()}
        class={cn(
          '-mx-1 min-w-[4ch] max-w-[calc(100%+0.5rem)] rounded-sm bg-input px-1 font-[inherit] text-[length:inherit] leading-[inherit] text-ink outline-none ring-1 ring-edge-muted focus:ring-ink/40 aria-invalid:ring-failure placeholder:text-ink-placeholder',
          props.width === 'fill'
            ? 'w-[calc(100%+0.5rem)]'
            : 'field-sizing-content'
        )}
        // Bound natively: editors such as Lexical stop input at their root,
        // before Solid's document-level delegation would see it, and stopping
        // these here keeps a row, tab list or grid from acting on them.
        on:focusin={(event) => event.stopPropagation()}
        on:mousedown={(event) => event.stopPropagation()}
        on:pointerdown={(event) => event.stopPropagation()}
        on:click={(event) => event.stopPropagation()}
        on:dblclick={(event) => event.stopPropagation()}
        on:input={(event) => props.rename.setDraft(event.currentTarget.value)}
        onBlur={() => props.rename.save(false)}
        on:keydown={(event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            props.rename.save(true, props.onSubmit);
            if (!props.onSubmit) returnFocus();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            props.rename.cancel(true);
            returnFocus();
          }
        }}
      />
      <Show when={props.rename.error()}>
        <span
          id={errorId}
          role="alert"
          class="menu-surface absolute top-full left-0 z-action-menu mt-1 w-56 p-2 text-xs font-normal text-failure-ink"
        >
          {props.rename.error()}
        </span>
      </Show>
    </span>
  );
}

export type RenameTitleProps<Target> = {
  rename: InlineRename<Target>;
  target: Target;
  startOn: 'click' | 'double-click';
  /** Shows the title without letting it be renamed. */
  readOnly?: boolean;
  'aria-label': string;
  placeholder?: string;
  maxLength?: number;
  /** Typography and placement of the title. */
  class?: string;
};

/**
 * An entity title that renames in place. Double-click starts editing a
 * compact title (a header, tab or row, where a click already means something);
 * a page heading, which is only ever edited, starts on click. F2 starts
 * editing from the keyboard either way, and a Rename menu item calls
 * `rename.begin` itself.
 *
 * @do Start a rename from a menu item only after the menu has closed and
 * handed focus back, or the returning focus blurs the field and saves it.
 * @do Return a `ResultAsync` that fails when the save fails, so the old name
 * comes back with a toast.
 * @do Use `validate` for names the surface refuses (duplicates), which keep
 * the field open with the reason.
 * @dont Build a one-off rename input, dialog or Save button for a title.
 * @dont Toast a rename failure yourself as well; the field reports it.
 */
export function RenameTitle<Target>(
  props: RenameTitleProps<Target>
): JSX.Element {
  const name = () => props.rename.displayName(props.target);
  const begin = (event: Event) => {
    if (props.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    props.rename.begin(props.target);
  };

  return (
    <Show
      when={!props.readOnly && props.rename.isRenaming(props.target)}
      fallback={
        <span
          class={cn(
            'min-w-0 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            !name() && 'text-ink-placeholder',
            props.class
          )}
          tabIndex={props.readOnly ? undefined : 0}
          aria-keyshortcuts={props.readOnly ? undefined : 'F2'}
          onClick={(event) => {
            if (props.startOn === 'click') begin(event);
          }}
          onDblClick={(event) => {
            if (props.startOn === 'double-click') begin(event);
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2') begin(event);
            else if (event.key === 'Enter' && props.startOn === 'click')
              begin(event);
          }}
        >
          {name() || props.placeholder}
        </span>
      }
    >
      <RenameInput
        rename={props.rename}
        aria-label={props['aria-label']}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        class={props.class}
      />
    </Show>
  );
}
