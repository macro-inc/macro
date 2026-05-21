import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import type { DateProperty } from '@core/component/Properties/types';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useKeyPressed } from '@core/util/useKeyPressed';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { cn } from '@ui';
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

  const hasClear = () => props.selectedDate != null;
  // When a date is set, replace the last suggestion with the Clear row so
  // the section height stays the same.
  const visibleDateOptions = createMemo(() => {
    const all = dateOptions();
    return hasClear() && all.length > 0 ? all.slice(0, -1) : all;
  });
  const calendarOptionIndex = () => visibleDateOptions().length;
  const clearOptionIndex = () => visibleDateOptions().length + 1;
  const totalOptions = createMemo(
    () => visibleDateOptions().length + 1 + (hasClear() ? 1 : 0)
  );

  createEffect(
    on(visibleDateOptions, (options) => {
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
    const options = visibleDateOptions();
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
    const options = visibleDateOptions();
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

      if (currentIndex === calendarOptionIndex()) {
        setMode('calendar');
      } else if (hasClear() && currentIndex === clearOptionIndex()) {
        handleClearDate();
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

  const handleCalendarChange = (date: Date) => {
    handleSelectDate(date);
  };

  return (
    <div class="relative">
      <div class="flex w-full items-center py-2 gap-2 px-2 border-b border-edge-muted">
        <SearchIcon class="size-4 text-ink-muted" />
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
          <div class="p-1.5">
            <div class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden">
              <Show
                when={visibleDateOptions().length > 0}
                fallback={
                  <Show
                    when={searchQuery().trim()}
                    fallback={
                      <Show when={!hasClear()}>
                        <div class="text-center py-2 text-ink-muted text-sm">
                          Enter a date or duration
                        </div>
                      </Show>
                    }
                  >
                    <div class="text-center py-2 text-ink-muted text-sm">
                      No dates match "{searchQuery()}"
                    </div>
                  </Show>
                }
              >
                <For each={visibleDateOptions()}>
                  {(option, index) => (
                    <div
                      data-date-index={index()}
                      class={cn(
                        'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 rounded-md',
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
                        <p class="truncate">{option.displayText}</p>
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
                  data-date-index={calendarOptionIndex()}
                  class={cn(
                    'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 rounded-md',
                    selectedIndex() === calendarOptionIndex() && 'bg-hover'
                  )}
                  onClick={() => setMode('calendar')}
                  onMouseEnter={() => {
                    if (!keyboardMode()) {
                      setSelectedIndex(calendarOptionIndex());
                    }
                  }}
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="flex-1 min-w-0">
                      <p class="truncate">Custom date...</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs text-ink-muted">
                      Pick from calendar
                    </span>
                  </div>
                </div>
                <Show when={hasClear()}>
                  <div
                    data-date-index={clearOptionIndex()}
                    class={cn(
                      'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 rounded-md',
                      selectedIndex() === clearOptionIndex() && 'bg-hover'
                    )}
                    onClick={() => handleClearDate()}
                    onMouseEnter={() => {
                      if (!keyboardMode()) {
                        setSelectedIndex(clearOptionIndex());
                      }
                    }}
                  >
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <p class="truncate text-ink-muted">Clear date</p>
                    </div>
                  </div>
                </Show>
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
