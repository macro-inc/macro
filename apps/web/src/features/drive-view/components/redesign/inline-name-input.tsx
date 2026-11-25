import { fireAndForget } from '@core/util/fireAndForget';
import { cn } from '@ui';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { renameSelectionRange } from '../../core/drive-items';

export type InlineNameInputProps = {
  initialValue: string;
  isFolder: boolean;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  class?: string;
  onCommit: (nextName: string) => Promise<void> | void;
  onCancel: () => void;
};

/**
 * Finder-style inline name field. Auto-focuses on mount, selects only the
 * filename stem before the extension for files (and the whole name for
 * folders), commits on Enter or blur, and cancels on Escape.
 */
export function InlineNameInput(props: InlineNameInputProps) {
  const [value, setValue] = createSignal(props.initialValue);
  let inputRef: HTMLInputElement | undefined;
  let settled = false;
  let readyForBlur = false;
  let mountRaf: number | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const focusAndSelect = () => {
    const el = inputRef;
    if (!el || settled) return;
    el.focus();
    const { start, end } = renameSelectionRange(
      props.initialValue,
      props.isFolder
    );
    el.setSelectionRange(start, end);
  };

  onMount(() => {
    focusAndSelect();
    // Guard against Kobalte Dropdown/ContextMenu focus-restoration firing right
    // after onSelect closes the menu and stealing focus back to the trigger.
    mountRaf = requestAnimationFrame(() => {
      if (settled) return;
      if (
        document.activeElement !== inputRef &&
        value() === props.initialValue
      ) {
        focusAndSelect();
      }
      settleTimer = setTimeout(() => {
        if (settled) return;
        if (
          document.activeElement !== inputRef &&
          value() === props.initialValue
        ) {
          focusAndSelect();
        }
        readyForBlur = true;
      }, 60);
    });
  });

  onCleanup(() => {
    if (mountRaf !== undefined) cancelAnimationFrame(mountRaf);
    if (settleTimer !== undefined) clearTimeout(settleTimer);
  });

  const commit = () => {
    if (settled || props.disabled) return;
    settled = true;
    const trimmed = value().trim();
    if (!trimmed) {
      props.onCancel();
      return;
    }
    const result = props.onCommit(trimmed);
    if (result instanceof Promise) {
      fireAndForget(result, 'drive-inline-name');
    }
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    props.onCancel();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      disabled={props.disabled}
      value={value()}
      data-blocks-navigation
      class={cn(
        'h-7 min-w-0 flex-1 rounded-md border border-edge-focus bg-surface px-2 text-sm font-medium text-ink shadow-xs outline-none ring-2 ring-accent/20 placeholder:text-ink-subtle',
        props.class
      )}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onInput={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        if (!readyForBlur) {
          focusAndSelect();
          return;
        }
        commit();
      }}
    />
  );
}
