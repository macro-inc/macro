import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type FlowComponent,
} from 'solid-js';
import { Combobox } from '@kobalte/core/combobox';
import { cn } from '@ui/utils/classname';
import { format } from 'date-fns';

type DateSelectorMode = 'search' | 'calendar';

type DateSelectorOption =
  | {
      type: 'option';
      displayText: string;
      secondaryText?: string;
      date: Date;
    }
  | { type: 'select-custom' }
  | { type: 'custom'; date: Date };

type DateSelectorProps = {
  selectedDate?: Date | null;
  onSelectDate?: (date: Date | null) => void;
};

export const DateSelector = (props: DateSelectorProps) => {
  const [selectedOption, setSelectedOption] =
    createSignal<DateSelectorOption | null>(
      props.selectedDate ? { type: 'custom', date: props.selectedDate } : null
    );

  const [mode, setMode] = createSignal<DateSelectorMode>('search');

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
    if (option?.type === 'select-custom') {
      setMode('calendar');
      return;
    }

    setSelectedOption(option);
    if (!option) {
      props.onSelectDate?.(null);
      return;
    }

    const dateValue = option.date;

    props.onSelectDate?.(dateValue);
  };

  const options = createMemo(() => {
    const list: DateSelectorOption[] = [];

    for (const option of dateOptions()) {
      list.push({
        type: 'option',
        displayText: option.displayText,
        secondaryText: option.secondaryText,
        date: option.date,
      });
    }

    list.push({
      type: 'select-custom',
    });

    return list;
  });

  const getOptionValue = (option: DateSelectorOption) => {
    if (option.type === 'select-custom') return '';
    return option.date.toString();
  };

  const getOptionTextValue = (option: DateSelectorOption) => {
    if (option.type === 'select-custom') return 'Custom date';

    return option.type === 'option' ? option.displayText : '';
  };

  const defaultFilter = (option: DateSelectorOption, input: string) => {
    if (option.type === 'select-custom' || option.type === 'custom')
      return true;

    return option.displayText
      .toLocaleLowerCase()
      .includes(input.toLocaleLowerCase());
  };

  return (
    <Combobox<DateSelectorOption>
      multiple={false}
      value={selectedOption()}
      options={options()}
      optionValue={getOptionValue}
      optionTextValue={getOptionTextValue}
      optionLabel={() => ''}
      onOpenChange={onOpenChange}
      onChange={onChange}
      onInputChange={onInputChange}
      allowsEmptyCollection
      placement="bottom-start"
      placeholder="Search dates"
      closeOnSelection={false}
      defaultFilter={defaultFilter}
      itemComponent={(itemProps) => {
        const label = () => {
          const item = itemProps.item.rawValue;

          if (item.type === 'option') return item.displayText;

          return 'Custom date';
        };

        const description = () => {
          const item = itemProps.item.rawValue;

          if (item.type === 'option') return item.secondaryText;
          return 'Pick from calendar';
        };

        return (
          <Combobox.Item
            item={itemProps.item}
            class={cn(
              'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 cursor-pointer data-[highlighted]:bg-hover',
              itemProps.item.rawValue.type === 'select-custom' &&
                'border-t border-edge-muted'
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
          <WithCustomDateMode
            selectedOption={selectedOption()}
            mode={mode()}
            onSelectDate={(date) => {
              onChange({ type: 'custom', date });
              setMode('search');
            }}
          >
            <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
              <Combobox.Input class="w-full caret-accent" autofocus />
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
          </WithCustomDateMode>
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
    if (props.selectedOption.type === 'select-custom') return '';
    try {
      return format(props.selectedOption.date, "MMMM d, yyyy 'at' h:mm a");
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

interface WithCustomDateModeProps {
  selectedOption: DateSelectorOption | null;
  mode: DateSelectorMode;
  onSelectDate: (date: Date) => void;
}

const WithCustomDateMode: FlowComponent<WithCustomDateModeProps> = (props) => {
  return (
    <Show when={props.mode === 'calendar'} fallback={props.children}>
      <div class="border-b border-edge-muted text-sm flex justify-center">
        <DatePickerUI
          value={
            props.selectedOption?.type === 'custom'
              ? props.selectedOption.date
              : new Date()
          }
          onChange={props.onSelectDate}
        />
      </div>
    </Show>
  );
};
