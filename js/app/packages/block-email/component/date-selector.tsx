import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useKeyPressed } from '@core/util/useKeyPressed';
import { Combobox } from '@kobalte/core/combobox';

type DateSelectorMode = 'search' | 'calendar';

type DateSelectorProps = {};

export const DateSelector = (props: DateSelectorProps) => {
  const [mode, setMode] = createSignal<DateSelectorMode>('search');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let searchInputRef!: HTMLInputElement;

  const dateOptions = useDateSearch({
    query: searchQuery,
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
    // props.onSelectDate(date);
    // if (props.onClose) {
    //   props.onClose();
    // }
  };

  const handleClearDate = (andClose = true) => {
    // props.onSelectDate(null);
    // if (props.onClose && andClose) {
    //   props.onClose();
    // }
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
    // if (!props.selectedDate) return 'No date set';
    // try {
    //   return format(props.selectedDate, "MMMM d, yyyy 'at' h:mm a");
    // } catch {
    //   return 'Invalid date';
    // }
  });

  const handleCalendarChange = (date: Date) => {
    handleSelectDate(date);
  };

  const options = createMemo(() => {
    return [...dateOptions()];
  });

  return (
    <Combobox
      multiple={false}
      options={dateOptions()}
      optionValue="id"
      optionTextValue="displayText"
      onInputChange={setSearchQuery}
      allowsEmptyCollection
      placement="bottom-start"
      placeholder="Search dates"
      itemComponent={(itemProps) => {
        return (
          <Combobox.Item
            item={itemProps.item}
            class="flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 cursor-pointer data-[highlighted]:bg-hover"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <Combobox.ItemLabel class="text-sm font-medium truncate">
                {itemProps.item.rawValue.displayText}
              </Combobox.ItemLabel>
            </div>

            <Combobox.ItemDescription as="span" class="text-xs text-ink-muted">
              {itemProps.item.rawValue.secondaryText}
            </Combobox.ItemDescription>
          </Combobox.Item>
        );
      }}
    >
      <Combobox.Control>
        <Combobox.Trigger>Open</Combobox.Trigger>
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content class="bg-dialog text-ink border border-edge-muted">
          <Show when={mode() === 'calendar'}>
            <div class="border-b border-edge-muted text-sm flex justify-center">
              <DatePickerUI
                value={new Date()}
                onChange={handleCalendarChange}
              />
            </div>
          </Show>
          <Show when={mode() === 'search'}>
            <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
              <Combobox.Input disabled={mode() !== 'search'} />
            </div>
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
              <Combobox.Listbox />
            </Show>

            <button
              type="button"
              class="w-full border-t border-edge-muted mt-1 pt-1 text-start"
              onClick={() => setMode('calendar')}
            >
              <div class="flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 cursor-pointer">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">Custom date...</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-xs text-ink-muted">Pick from calendar</span>
                </div>
              </div>
            </button>
            <div class="px-2 py-1.5 border-t border-edge-muted">
              <div class="text-xs text-ink-muted">
                <span>Use queries like </span>
                <code class="bg-active px-1">3d</code>,{' '}
                <code class="bg-active px-1">1w</code>,{' '}
                <code class="bg-active px-1">feb 17</code>, or{' '}
                <code class="bg-active px-1">tomorrow</code>
              </div>
            </div>
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
};
