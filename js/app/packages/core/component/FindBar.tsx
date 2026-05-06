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
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** 1-based index of the active result. Use 0 when there is no active result. */
  index?: number;
  /** Total number of results. Omit when total is not yet known. */
  total?: number;
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
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      props.onNext();
      return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      props.onPrevious();
    }
  };

  const showCount = () =>
    typeof props.index === 'number' &&
    props.index > 0 &&
    typeof props.total === 'number' &&
    !!props.query.trim();

  return (
    <div
      class={cn(
        'flex items-center gap-1 rounded-md border border-edge bg-panel p-1 shadow-md focus-within:border-accent',
        props.class
      )}
    >
      <MagnifyingGlass class="ml-1 size-4 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        class="min-w-0 flex-1 bg-transparent border-0 px-1 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-0"
        placeholder={props.placeholder ?? 'Find'}
        value={props.query}
        onInput={(e) => props.onQueryChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <Show when={showCount()}>
        <span class="px-1 text-xs text-ink-muted tabular-nums whitespace-nowrap">
          {props.index}/{props.total}
        </span>
      </Show>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous match"
        onClick={() => props.onPrevious()}
      >
        <CaretUp />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next match"
        onClick={() => props.onNext()}
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
