import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useSearchInputFocus } from '@core/component/Properties/utils';
import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import {
  createMemo,
  createSignal,
  type JSX,
  Show,
  type FlowComponent,
  type Component,
  createEffect,
  on,
} from 'solid-js';
import {
  Combobox,
  type ComboboxRootItemComponentProps,
} from '@kobalte/core/combobox';
import { cn } from '@ui/utils/classname';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { Layer } from '@ui';

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
  open?: boolean;
  onClose?: VoidFunction;
  selectedDate?: Date | null;
  onSelectDate?: (date: Date | null) => void;
  placeholder?: string;
  disablePriorToDate?: Date;
  disableAfterDate?: Date;
  withTime?: boolean;
  /** Render content inline instead of in a portal (avoids keyboard positioning issues on mobile) */
  disablePortal?: boolean;
  disabled?: boolean;
  trigger?:
    | JSX.Element
    | ((props: { selectedDate: Date | null }) => JSX.Element);
};

const DateSelectorPortalWrapper: FlowComponent<{ disabled?: boolean }> = (
  props
) => {
  if (props.disabled) return <>{props.children}</>;
  return <Combobox.Portal>{props.children}</Combobox.Portal>;
};

export const DateSelector = (props: DateSelectorProps) => {
  const [selectedOption, setSelectedOption] =
    createSignal<DateSelectorOption | null>(
      props.selectedDate ? { type: 'custom', date: props.selectedDate } : null
    );

  createEffect(
    on(
      () => props.selectedDate,
      () => {
        const next = props.selectedDate
          ? { type: 'custom' as const, date: props.selectedDate }
          : null;
        const current = selectedOption();

        if (
          current?.type !== 'select-custom' &&
          current?.date.toString() === next?.date.toString()
        )
          return;

        setSelectedOption(next);
      }
    )
  );

  const [internalOpen, setInternalOpen] = createSignal(props.open ?? false);
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open !== undefined) setInternalOpen(open);
      },
      { defer: true }
    )
  );
  const isControlled = () => props.open !== undefined;
  const isOpen = () => (isControlled() ? props.open! : internalOpen());
  const [mode, setMode] = createSignal<DateSelectorMode>('search');

  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();
  const [searchInputRef, setSearchInputRef] = createSignal<
    HTMLInputElement | undefined
  >();

  const dateOptions = useDateSearch({
    query: searchQuery,
    baseDate: startOfDay(new Date()),
    defaultTime: { hours: 8, minutes: 0 },
  });

  const dispatchKeyToListbox = (key: string) => {
    listboxRef()?.dispatchEvent(
      // We need to send `bubbles: true` because otherwise Kobalte ignores the event
      new KeyboardEvent('keydown', { bubbles: true, key: key })
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target;
    const isNonComboboxInput =
      target instanceof HTMLInputElement && target !== searchInputRef();

    switch (e.key) {
      case 'Delete':
      case 'Backspace': {
        if (isNonComboboxInput || searchQuery().trim()) {
          return;
        }
        e.preventDefault();
        onChange(null);

        break;
      }
      case 'j': {
        if (!e.ctrlKey) return;

        e.preventDefault();
        dispatchKeyToListbox('ArrowDown');
        break;
      }
      case 'k': {
        if (!e.ctrlKey) return;

        e.preventDefault();
        dispatchKeyToListbox('ArrowUp');
        break;
      }
    }
  };

  useSearchInputFocus(
    () => searchInputRef(),
    () => true
  );

  const onInputChange = (value: string) => {
    setSearchQuery(value);

    // Send the keydown event to the listbox so Kobalte's internal system can update the focus state
    // This makes it so it behaves the same as if you had manually pressed the down arrow to focus the item
    queueMicrotask(() => {
      dispatchKeyToListbox('ArrowDown');
    });
  };

  const resetState = () => {
    setSearchQuery('');
    setMode('search');
  };

  const onOpenChange = (open: boolean) => {
    setInternalOpen(open);
    if (!open) {
      resetState();
      props.onClose?.();
    }
  };

  const onChange = (option: DateSelectorOption | null) => {
    if (option?.type === 'select-custom') {
      setMode('calendar');
      return;
    }

    setSelectedOption(option);
    if (!option) {
      props.onSelectDate?.(null);
      onOpenChange(false);
      return;
    }

    const dateValue = option.date;

    props.onSelectDate?.(dateValue);
    onOpenChange(false);
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

  const selectedDate = () => {
    const option = selectedOption();

    if (!option || option.type === 'select-custom') return null;

    return option.date;
  };

  const onTimeInputChange = (e: Event) => {
    if (!(e.currentTarget instanceof HTMLInputElement)) return;
    const value = e.currentTarget.value;

    if (!value || !value.trim().length) {
      const currentDate = selectedDate() ?? new Date();

      onChange({
        type: 'custom',
        date: startOfDay(currentDate),
      });
      return;
    }

    const split = value.split(':');
    if (!split.length || split.length !== 2) return;

    if (Number.isNaN(split[0]) || Number.isNaN(split[1])) return;

    let hours = Number(split[0]);
    let mins = Number(split[1]);

    let currentDate = selectedDate() ?? new Date();

    currentDate = setHours(currentDate, Number(hours));
    currentDate = setMinutes(currentDate, Number(mins));

    onChange({ type: 'custom', date: currentDate });
  };

  return (
    <Combobox<DateSelectorOption>
      open={isOpen()}
      disabled={props.disabled}
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
      placeholder={props.placeholder ?? 'Select date'}
      closeOnSelection={false}
      // Filtering is done by `useDateSearch`
      defaultFilter={() => true}
      itemComponent={DateSelectorItem}
    >
      <Show when={typeof props.trigger !== 'undefined'}>
        <Combobox.Control>
          <Combobox.Trigger
            class="flex group/date-selector-trigger"
            tabIndex={0}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setInternalOpen(true);
              }
            }}
          >
            {typeof props.trigger === 'function'
              ? props.trigger({ selectedDate: selectedDate() })
              : props.trigger}
          </Combobox.Trigger>
        </Combobox.Control>
      </Show>

      <DateSelectorPortalWrapper disabled={props.disablePortal}>
        <Layer depth={3}>
          <Combobox.Content
            class="w-full max-w-sm bg-dialog text-ink border border-edge"
            on:keydown={handleKeyDown}
          >
            <WithCustomDateMode
              selectedDate={selectedDate()}
              disablePriorToDate={props.disablePriorToDate}
              disableAfterDate={props.disableAfterDate}
              mode={mode()}
              onSelectDate={(date) => {
                onChange({ type: 'custom', date });
                setInternalOpen(false);
              }}
            >
              <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
                <SearchIcon class="h-4 w-4 text-ink-muted" />
                <Combobox.Input
                  ref={setSearchInputRef}
                  class="w-full caret-accent"
                  autofocus
                />
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
              <Show when={props.withTime}>
                <div class="px-2 py-1.5 border-t border-edge-muted">
                  <label class="flex items-center justify-between text-sm">
                    Time
                    <input
                      type="time"
                      value={
                        selectedDate()
                          ? format(selectedDate()!, 'HH:mm')
                          : undefined
                      }
                      onInput={onTimeInputChange}
                    />
                  </label>
                </div>
              </Show>
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
        </Layer>
      </DateSelectorPortalWrapper>
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
          onPointerDown={(e: PointerEvent) => e.preventDefault()}
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
  selectedDate: Date | null;
  mode: DateSelectorMode;
  onSelectDate: (date: Date) => void;
  disablePriorToDate?: Date;
  disableAfterDate?: Date;
}

const WithCustomDateMode: FlowComponent<WithCustomDateModeProps> = (props) => {
  return (
    <Show when={props.mode === 'calendar'} fallback={props.children}>
      <div class="border-b border-edge-muted text-sm flex justify-center">
        <DatePickerUI
          disablePriorToDate={props.disablePriorToDate}
          disableAfterDate={props.disableAfterDate}
          value={props.selectedDate ?? new Date()}
          onChange={props.onSelectDate}
          showTimePicker
        />
      </div>
    </Show>
  );
};

const DateSelectorItem: Component<
  ComboboxRootItemComponentProps<DateSelectorOption>
> = (props) => {
  const label = () => {
    const item = props.item.rawValue;

    if (item.type === 'option') return item.displayText;

    return 'Custom date';
  };

  const description = () => {
    const item = props.item.rawValue;

    if (item.type === 'option') return item.secondaryText;
    return 'Pick from calendar';
  };

  return (
    <Combobox.Item
      item={props.item}
      class={cn(
        'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 relative data-highlighted:bg-hover',
        props.item.rawValue.type === 'select-custom' &&
          'border-t border-edge-muted'
      )}
      onPointerDown={(e: PointerEvent) => {
        // Prevent default to stop input blur on mobile, which would close the
        // combobox before the selection click event fires.
        e.preventDefault();
      }}
    >
      <Combobox.ItemIndicator class="hidden" />
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <Combobox.ItemLabel class="text-sm font-medium truncate">
          {label()}
        </Combobox.ItemLabel>
      </div>

      <Show when={description()}>
        <Combobox.ItemDescription as="span" class="text-xs text-ink-muted">
          {description()}
        </Combobox.ItemDescription>
      </Show>
    </Combobox.Item>
  );
};
