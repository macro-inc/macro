import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { cn } from '@ui/utils/classname';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { format } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { DateProperty } from '@core/component/Properties/types';
import { useKeyPressed } from '@core/util/useKeyPressed';

type DateSelectorMode = 'search' | 'calendar';

type DateSelectorProps = {
  property: DateProperty;
  selectedDate?: Date | null;
  onSelectDate: (date: Date | null) => void;
  onClose?: () => void;
};

export const PropertyDateSelector = (props: DateSelectorProps) => {
  const [mode, setMode] = createSignal<DateSelectorMode>('search');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let searchInputRef!: HTMLInputElement;
  const keyboardMode = useKeyPressed(100);

  const dateOptions = useDateSearch({
    query: searchQuery,
    showTimeInResults: false,
  });

  const totalOptions = createMemo(() => dateOptions().length + 1); // +1 for calendar button

  createEffect(
    on(dateOptions, (options) => {
      if (options.length === 0) {
        setSelectedIndex(0);
      } else {
        setSelectedIndex(Math.min(selectedIndex(), totalOptions() - 1));
      }
    })
  );

  const handleSelectDate = (date: Date) => {
    props.onSelectDate(date);
    if (props.onClose) {
      props.onClose();
    }
  };

  const handleClearDate = (andClose = true) => {
    props.onSelectDate(null);
    if (props.onClose && andClose) {
      props.onClose();
    }
  };

  const scrollSelectedIntoView = () => {
    const options = dateOptions();
    const currentIndex = selectedIndex();
    if (currentIndex >= 0 && currentIndex < options.length) {
      const element = document.querySelector(
        `[data-date-index="${currentIndex}"]`
      );
      if (element) {
        element.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const options = dateOptions();
    const total = totalOptions();

    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      !searchQuery().trim()
    ) {
      handleClearDate(false);
      e.preventDefault();
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % total);
      scrollSelectedIntoView();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + total) % total);
      scrollSelectedIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const currentIndex = selectedIndex();

      if (currentIndex === options.length) {
        setMode('calendar');
      } else {
        const selectedOption = options[currentIndex];
        if (selectedOption) {
          handleSelectDate(selectedOption.date);
        }
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

  const currentDateDisplay = createMemo(() => {
    if (!props.selectedDate) return 'No date set';
    try {
      return format(props.selectedDate, "MMMM d, yyyy 'at' h:mm a");
    } catch {
      return 'Invalid date';
    }
  });

  const handleCalendarChange = (date: Date) => {
    handleSelectDate(date);
  };

  return (
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
          disabled={mode() !== 'search'}
        />
      </div>
      <Switch>
        <Match when={mode() === 'search'}>
          <Show when={props.selectedDate}>
            <div class="px-3 py-2 border-b border-edge-muted pattern pattern-edge-muted pattern-dot-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-ink-muted">Current:</span>
                  <span class="text-xs font-medium">
                    {currentDateDisplay()}
                  </span>
                </div>
                <button
                  onClick={() => handleClearDate(true)}
                  class="text-xs text-ink-muted hover:text-ink underline"
                >
                  Clear
                </button>
              </div>
            </div>
          </Show>

          <div class="p-1">
            <div class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
              <Show
                when={dateOptions().length > 0}
                fallback={
                  <Show
                    when={searchQuery().trim()}
                    fallback={
                      <div class="text-center py-2 text-ink-muted text-sm">
                        Enter a date or duration
                      </div>
                    }
                  >
                    <div class="text-center py-2 text-ink-muted text-sm">
                      No dates match "{searchQuery()}"
                    </div>
                  </Show>
                }
              >
                <For each={dateOptions()}>
                  {(option, index) => (
                    <div
                      data-date-index={index()}
                      class={cn(
                        'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2',
                        index() === selectedIndex() && 'bg-hover'
                      )}
                      onClick={() => handleSelectDate(option.date)}
                      onMouseEnter={() => {
                        if (!keyboardMode()) {
                          setSelectedIndex(index());
                        }
                      }}
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <p class="text-sm font-medium truncate">
                          {option.displayText}
                        </p>
                      </div>

                      <span class="text-xs text-ink-muted">
                        {option.secondaryText}
                      </span>
                    </div>
                  )}
                </For>
              </Show>

              <div class="border-t border-edge-muted mt-1 pt-1">
                <div
                  data-date-index={dateOptions().length}
                  class={cn(
                    'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2',
                    selectedIndex() === dateOptions().length && 'bg-hover'
                  )}
                  onClick={() => setMode('calendar')}
                  onMouseEnter={() => {
                    if (!keyboardMode()) {
                      setSelectedIndex(dateOptions().length);
                    }
                  }}
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">Custom date...</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs text-ink-muted">
                      Pick from calendar
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Help text */}
          <div class="px-2 py-1.5 border-t border-edge-muted">
            <div class="text-xs text-ink-muted">
              <span>Use queries like </span>
              <code class="bg-active px-1">3d</code>,{' '}
              <code class="bg-active px-1">1w</code>,{' '}
              <code class="bg-active px-1">feb 17</code>, or{' '}
              <code class="bg-active px-1">tomorrow</code>
            </div>
          </div>
        </Match>

        <Match when={mode() === 'calendar'}>
          <div class="border-b border-edge-muted text-sm flex justify-center">
            <DatePickerUI
              value={props.selectedDate || new Date()}
              onChange={handleCalendarChange}
            />
          </div>
        </Match>
      </Switch>
    </div>
  );
};
