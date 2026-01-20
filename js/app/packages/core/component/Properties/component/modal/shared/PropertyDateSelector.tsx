import { Hotkey } from '@core/component/Hotkey';
import { useDateSearch } from '@core/component/KeyboardDatePicker/useDateSearch';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import CalendarIcon from '@icon/regular/calendar.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { format } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { DateProperty } from '@core/component/Properties/types';

type DateSelectorProps = {
  property: DateProperty;
  selectedDate?: Date | null;
  onSelectDate: (date: Date | null) => void;
  onClose?: () => void;
};

export const PropertyDateSelector = (props: DateSelectorProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [keyboardNavigationTimeout, setKeyboardNavigationTimeout] =
    createSignal<number | null>(null);

  let searchInputRef!: HTMLInputElement;

  const dateOptions = useDateSearch({
    query: searchQuery,
    baseDate: props.selectedDate || undefined,
  });

  createEffect(() => {
    const options = dateOptions();
    if (options.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), options.length - 1));
    }
  });

  const isKeyboardNavigating = () => {
    const timeout = keyboardNavigationTimeout();
    return timeout !== null && Date.now() - timeout < 150;
  };

  const shouldShowHotkeys = createMemo(() => {
    return !searchQuery().trim() && dateOptions().length <= 9;
  });

  const handleSelectDate = (date: Date) => {
    props.onSelectDate(date);
    if (props.onClose) {
      props.onClose();
    }
  };

  const handleClearDate = () => {
    props.onSelectDate(null);
    if (props.onClose) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = dateOptions();
    if (options.length === 0 && e.key !== 'Delete' && e.key !== 'Backspace') {
      return;
    }

    // Handle clearing date with Delete or Backspace when search is empty
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      !searchQuery().trim()
    ) {
      e.preventDefault();
      handleClearDate();
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setKeyboardNavigationTimeout(Date.now());
      setSelectedIndex((prev) => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setKeyboardNavigationTimeout(Date.now());
      setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedOption = options[selectedIndex()];
      if (selectedOption) {
        handleSelectDate(selectedOption.date);
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  useSearchInputFocus(
    () => searchInputRef,
    () => true
  );

  // Format the currently selected date for display
  const currentDateDisplay = createMemo(() => {
    if (!props.selectedDate) return 'No date set';

    try {
      return format(props.selectedDate, "MMMM d, yyyy 'at' h:mm a");
    } catch {
      return 'Invalid date';
    }
  });

  return (
    <div>
      {/* Search input */}
      <div class="relative">
        <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
          <SearchIcon class="h-4 w-4 text-ink-muted" />
          <input
            class="w-full caret-accent"
            ref={searchInputRef}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (props.onClose) {
                  props.onClose();
                }
              }
            }}
            placeholder={`Set ${props.property.displayName.toLowerCase()}...`}
          />
        </div>
      </div>

      <Show when={props.selectedDate}>
        <div class="px-3 py-2 border-b border-edge-muted">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <CalendarIcon class="h-3 w-3 text-ink-muted" />
              <span class="text-xs text-ink-muted">Current:</span>
              <span class="text-xs font-medium">{currentDateDisplay()}</span>
            </div>
            <button
              onClick={handleClearDate}
              class="text-xs text-ink-muted hover:text-ink underline"
            >
              Clear
            </button>
          </div>
        </div>
      </Show>

      {/* Options list */}
      <div class="p-1">
        <div class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
          <Show
            when={dateOptions().length > 0}
            fallback={
              <Show
                when={searchQuery().trim()}
                fallback={
                  <div class="text-center py-4 text-ink-muted text-sm">
                    Enter a date or duration
                  </div>
                }
              >
                <div class="text-center py-4 text-ink-muted text-sm">
                  No dates match "{searchQuery()}"
                </div>
              </Show>
            }
          >
            <For each={dateOptions()}>
              {(option, index) => (
                <div
                  class={`flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 cursor-pointer ${
                    index() === selectedIndex() ? 'bg-hover' : ''
                  }`}
                  onClick={() => handleSelectDate(option.date)}
                  onMouseEnter={() => {
                    if (!isKeyboardNavigating()) {
                      setSelectedIndex(index());
                    }
                  }}
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    {/* Main text */}
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">
                        {option.displayText}
                      </p>
                    </div>
                  </div>

                  {/* Right side: date preview and hotkey */}
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="text-xs text-ink-muted">
                      {option.secondaryText}
                    </span>
                    <Show when={shouldShowHotkeys() && index() < 9}>
                      <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                        <Hotkey shortcut={`${index() + 1}`} />
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* Help text */}
      <div class="px-2 py-1.5 border-t border-edge-muted">
        <div class="text-[10px] text-ink-muted">
          <span class="font-medium">Tips:</span> Use arrow keys to navigate. Try{' '}
          <code class="font-mono bg-active px-1 rounded">3d</code>,{' '}
          <code class="font-mono bg-active px-1 rounded">1w</code>,{' '}
          <code class="font-mono bg-active px-1 rounded">feb 17</code>, or{' '}
          <code class="font-mono bg-active px-1 rounded">tomorrow</code>
        </div>
      </div>
    </div>
  );
};
