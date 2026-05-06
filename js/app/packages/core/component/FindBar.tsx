import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import MagnifyingGlass from '@icon/regular/magnifying-glass.svg';
import X from '@icon/regular/x.svg';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import { type JSX, onMount, Show } from 'solid-js';

export type FindBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** 1-based index of the active result. Use 0 when there is no active result. */
  index?: number;
  /** Total number of results. Omit when total is not yet known. */
  total?: number;
  /** Whether the typed query differs from the most recently submitted one. */
  hasUnsubmittedChanges?: boolean;
  /** True while a submitted query is in flight; suppresses the count. */
  isPending?: boolean;
  /**
   * Which physical key advances the cursor. Defaults to `'asc'` —
   * ArrowDown/Enter advance, ArrowUp/Shift+Enter retreat. Use `'desc'` for
   * surfaces (like a chat channel) where the natural reading direction is
   * bottom-to-top: ArrowUp/Enter advance, ArrowDown/Shift+Enter retreat.
   */
  direction?: 'asc' | 'desc';
  placeholder?: string;
  autofocus?: boolean;
  inputRef?: (el: HTMLInputElement) => void;
  class?: string;
};

export function FindBar(props: FindBarProps) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    if (inputRef) props.inputRef?.(inputRef);
    if (props.autofocus !== false) {
      inputRef?.focus();
      inputRef?.select();
    }
  });

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (props.hasUnsubmittedChanges && !e.shiftKey) {
        props.onSubmit();
      } else if (e.shiftKey) {
        props.onPrevious();
      } else {
        props.onNext();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (props.direction === 'desc') props.onPrevious();
      else props.onNext();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (props.direction === 'desc') props.onNext();
      else props.onPrevious();
    }
  };

  const showCount = () =>
    typeof props.index === 'number' &&
    typeof props.total === 'number' &&
    !!props.query.trim() &&
    !props.hasUnsubmittedChanges &&
    !props.isPending;

  return (
    <div
      class={cn(
        'flex items-center gap-1 rounded-md border border-edge bg-panel p-1 shadow-md focus-within:border-accent',
        props.class
      )}
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Search"
        onClick={() => props.onSubmit()}
        classList={{
          '!text-accent':
            !props.hasUnsubmittedChanges && !!props.query.trim(),
        }}
      >
        <MagnifyingGlass />
      </Button>
      <input
        ref={inputRef}
        type="text"
        class="min-w-0 flex-1 bg-transparent border-0 px-1 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-0"
        placeholder={props.placeholder ?? 'Find'}
        value={props.query}
        onInput={(e) => props.onQueryChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <Show when={typeof props.total === 'number'}>
        <span
          class="px-1 text-xs text-ink-muted tabular-nums whitespace-nowrap"
          classList={{ invisible: !showCount() }}
        >
          {props.index ?? 0}/{props.total}
        </span>
      </Show>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={props.direction === 'desc' ? 'Next match' : 'Previous match'}
        onClick={() =>
          props.direction === 'desc' ? props.onNext() : props.onPrevious()
        }
      >
        <CaretUp />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={props.direction === 'desc' ? 'Previous match' : 'Next match'}
        onClick={() =>
          props.direction === 'desc' ? props.onPrevious() : props.onNext()
        }
      >
        <CaretDown />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close find bar"
        onClick={() => props.onClose()}
      >
        <X />
      </Button>
    </div>
  );
}
