import {
  useDateSearch,
  type DateOption,
} from '@core/util/dateSearch/useDateSearch';
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
import { Combobox } from '@kobalte/core/combobox';
import { cn } from '@ui/utils/classname';
import { format } from 'date-fns';

type DateSelectorMode = 'search' | 'calendar';

type DateSelectorOption =
  | {
      custom: false;
      context: DateOption;
    }
  | { custom: true; date: Date };

type DateSelectorProps = {
  selectedDate?: Date | null;
  onSelectDate?: (date: Date | null) => void;
};

export const DateSelector = (props: DateSelectorProps) => {
  const [selectedOption, setSelectedOption] =
    createSignal<DateSelectorOption | null>(
      props.selectedDate ? { custom: true, date: props.selectedDate } : null
    );

  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();
  let searchInputRef!: HTMLInputElement;

  const dateOptions = useDateSearch({
    query: searchQuery,
  });

  const handleKeyDown = (e: KeyboardEvent) => {};

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

  const onInputChange = (value: string) => {
    setSearchQuery(value);

    // Send the keydown event to the listbox so Kobalte's internal system can update the focus state
    // This makes it so it behaves the same as if you had manually pressed the down arrow to focus the item
    queueMicrotask(() => {
      listboxRef()?.dispatchEvent(
        // We need to send `bubbles: true` because otherwise Kobalte ignores the event
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      );
    });
  };

  const resetState = () => {
    setSearchQuery('');
  };

  const onOpenChange = (open: boolean) => {
    if (!open) resetState();
  };

  const onChange = (option: DateSelectorOption | null) => {
    setSelectedOption(option);
    if (!option) {
      props.onSelectDate?.(null);
      return;
    }

    const dateValue = option.custom ? option.date : option.context.date;

    props.onSelectDate?.(dateValue);
  };

  const options = createMemo(() => {
    return [
      ...dateOptions().map((o) => ({ custom: false, context: o }) as const),
      { custom: true, date: new Date() } as const,
    ];
  });

  const getOptionLabel = (option: DateSelectorOption) => {
    try {
      return format(
        option.custom ? option.date : option.context.date,
        "MMMM d, yyyy 'at' h:mm a"
      );
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <Combobox<DateSelectorOption>
      multiple={false}
      value={selectedOption()}
      options={options()}
      optionValue={(o) =>
        o.custom ? o.date.toString() : o.context.date.toString()
      }
      optionTextValue={(o) =>
        o.custom ? 'Custom date' : o.context.displayText
      }
      optionLabel={getOptionLabel}
      onOpenChange={onOpenChange}
      onChange={onChange}
      onInputChange={onInputChange}
      allowsEmptyCollection
      placement="bottom-start"
      placeholder="Search dates"
      defaultFilter={(option, search) =>
        option.custom
          ? true
          : option.context.displayText
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase())
      }
      itemComponent={(itemProps) => {
        const label = () => {
          const item = itemProps.item.rawValue;

          if (item.custom) return 'Custom date';

          return item.context.displayText;
        };

        const description = () => {
          const item = itemProps.item.rawValue;

          if (item.custom) return 'Pick from calendar';

          return item.context.secondaryText;
        };

        return (
          <Combobox.Item
            item={itemProps.item}
            class={cn(
              'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 cursor-pointer data-[highlighted]:bg-hover',
              itemProps.item.rawValue.custom && 'border-t border-edge-muted'
            )}
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <Combobox.ItemLabel class="text-sm font-medium truncate">
                {label()}
              </Combobox.ItemLabel>
            </div>

            <Show when={description()}>
              <Combobox.ItemDescription
                as="span"
                class="text-xs text-ink-muted"
              >
                {description()}
              </Combobox.ItemDescription>
            </Show>
          </Combobox.Item>
        );
      }}
    >
      <Combobox.Control>
        <Combobox.Trigger>Open</Combobox.Trigger>
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content class="w-full max-w-sm bg-dialog text-ink border border-edge-muted">
          <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
            <SearchIcon class="h-4 w-4 text-ink-muted" />
            <Combobox.Input class="w-full caret-accent" />
          </div>

          <Show when={selectedOption()}>
            {(option) => (
              <CurrentValueDisplay
                selectedOption={option()}
                onClear={() => {
                  onChange(null);
                }}
              />
            )}
          </Show>
          <Show when={dateOptions().length === 0}>
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
          </Show>
          <Combobox.Listbox ref={setListboxRef} />

          <div class="px-2 py-1.5 border-t border-edge-muted">
            <div class="text-xs text-ink-muted">
              <span>Use queries like </span>
              <code class="bg-active px-1">3d</code>,{' '}
              <code class="bg-active px-1">1w</code>,{' '}
              <code class="bg-active px-1">feb 17</code>, or{' '}
              <code class="bg-active px-1">tomorrow</code>
            </div>
          </div>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
};

interface CurrentValueDisplayProps {
  selectedOption: DateSelectorOption;
  onClear: VoidFunction;
}

const CurrentValueDisplay = (props: CurrentValueDisplayProps) => {
  const currentDateDisplay = createMemo(() => {
    try {
      return format(
        props.selectedOption.custom
          ? props.selectedOption.date
          : props.selectedOption.context.date,
        "MMMM d, yyyy 'at' h:mm a"
      );
    } catch {
      return 'Invalid date';
    }
  });

  return (
    <div class="px-3 py-2 border-b border-edge-muted pattern pattern-edge-muted pattern-dot-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink-muted">Current:</span>
          <span class="text-xs font-medium">{currentDateDisplay()}</span>
        </div>
        <button
          onClick={props.onClear}
          class="text-xs text-ink-muted hover:text-ink underline"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
