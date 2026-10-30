import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createTimeOptions } from '@core/util/dateSearch/timeOptions';
import { fireAndForget } from '@core/util/fireAndForget';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import {
  Combobox,
  type ComboboxRootItemComponentProps,
} from '@kobalte/core/combobox';
import { useSearchInputFocus } from '@property/utils/focus';
import { Hotkey, highlightFirstMenuItemOnOpen, Surface } from '@ui';
import {
  differenceInCalendarDays,
  format,
  setHours,
  setMinutes,
  startOfDay,
} from 'date-fns';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type FlowComponent,
  type JSX,
  on,
  Show,
} from 'solid-js';
import {
  SEND_LATER_DEFAULT_TIME,
  sendLaterPresets,
} from '../core/send-later-presets';

type DateSelectorMode = 'search' | 'calendar';

type DateSelectorOption =
  | {
      type: 'option';
      id: string;
      label: string;
      date: Date;
      /** Opt+digit picks this preset; numbered from 1. */
      presetNumber?: number;
    }
  | { type: 'select-custom' }
  | { type: 'custom'; date: Date };

type DateSelectorProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selectedDate?: Date | null;
  /** Return false (or reject) to leave the confirmed selection unchanged. */
  onSelectDate?: (
    date: Date | null
  ) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  disablePriorToDate?: Date;
  disableAfterDate?: Date;
  withTime?: boolean;
  /** Render content inline instead of in a portal (avoids keyboard positioning issues on mobile) */
  disablePortal?: boolean;
  disabled?: boolean;
  triggerClass?: string;
  triggerLabel?: string;
  clearLabel?: string;
  currentLabel?: string;
  /** Show the selected date in the menu above its clear action. */
  showCurrentValue?: boolean;
  clearable?: boolean;
  footer?: JSX.Element;
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

  const [internalOpen, setInternalOpen] = createSignal(false);
  const isOpen = () => props.open ?? internalOpen();
  const [mode, setMode] = createSignal<DateSelectorMode>('search');

  // Where focus was when the menu opened. Closing returns it there so the
  // composer keeps its shortcuts; left to Kobalte it ends up on the page.
  // Touch keeps Kobalte's behavior so closing never raises the keyboard.
  let focusOnClose: HTMLElement | undefined;
  createEffect(
    on(isOpen, (open) => {
      if (!open || isTouchDevice()) return;
      const active = document.activeElement;
      focusOnClose =
        active instanceof HTMLElement && active !== document.body
          ? active
          : undefined;
    })
  );

  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();
  const [searchInputRef, setSearchInputRef] = createSignal<
    HTMLInputElement | undefined
  >();

  const timeOptions = createTimeOptions({
    query: searchQuery,
    defaultTime: SEND_LATER_DEFAULT_TIME,
    presets: sendLaterPresets,
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

    // `code`, not `key`: macOS types "¡" for Option+1.
    const presetDigit =
      e.altKey && !e.metaKey && !e.ctrlKey
        ? /^Digit([1-9])$/.exec(e.code)?.[1]
        : undefined;
    const preset = presetDigit
      ? sendLaterPresets(new Date())[Number(presetDigit) - 1]
      : undefined;
    if (preset) {
      e.preventDefault();
      fireAndForget(onChange({ type: 'option', ...preset }), 'email-compose');
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace': {
        if (
          props.clearable === false ||
          isNonComboboxInput ||
          searchQuery().trim()
        ) {
          return;
        }
        e.preventDefault();
        fireAndForget(onChange(null), 'email-compose');

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
    () => isTouchDevice()
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

  const setOpen = (open: boolean) => {
    setInternalOpen(open);
    props.onOpenChange?.(open);
    if (open) return;
    resetState();
    // Kobalte restores focus a tick after the input is gone, leaving the page
    // focused in between; restore it while the input still exists.
    if (focusOnClose?.isConnected) focusOnClose.focus();
  };

  const onChange = async (option: DateSelectorOption | null) => {
    if (option?.type === 'select-custom') {
      setMode('calendar');
      return;
    }

    setOpen(false);
    const dateValue = option?.date ?? null;
    try {
      const accepted = await props.onSelectDate?.(dateValue);
      if (accepted !== false) setSelectedOption(option);
    } catch {
      // The caller owns request feedback. Keep showing the last confirmed value.
    }
  };

  const options = createMemo((): DateSelectorOption[] => {
    const presetIds = sendLaterPresets(new Date()).map((preset) => preset.id);
    return [
      ...timeOptions().map((option): DateSelectorOption => {
        const index = presetIds.indexOf(option.id);
        return {
          type: 'option',
          ...option,
          presetNumber: index >= 0 ? index + 1 : undefined,
        };
      }),
      { type: 'select-custom' },
    ];
  });

  // Ids, not dates: on Sundays "Tomorrow morning" and "Monday morning" are
  // the same instant.
  const getOptionValue = (option: DateSelectorOption) => {
    if (option.type === 'select-custom') return '';
    if (option.type === 'option') return option.id;
    return option.date.toString();
  };

  const getOptionTextValue = (option: DateSelectorOption) => {
    if (option.type === 'select-custom') return 'Custom date';

    return option.type === 'option' ? option.label : '';
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

      fireAndForget(
        onChange({
          type: 'custom',
          date: startOfDay(currentDate),
        }),
        'email-compose'
      );
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

    fireAndForget(
      onChange({ type: 'custom', date: currentDate }),
      'email-compose'
    );
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
      onOpenChange={setOpen}
      onChange={onChange}
      onInputChange={onInputChange}
      allowsEmptyCollection
      placement="bottom-start"
      placeholder={props.placeholder ?? 'Select date'}
      closeOnSelection={false}
      // Filtering is done by `createTimeOptions`
      defaultFilter={() => true}
      itemComponent={DateSelectorItem}
    >
      <Show when={typeof props.trigger !== 'undefined'}>
        <Combobox.Control>
          <Combobox.Trigger
            class={props.triggerClass ?? 'flex group/date-selector-trigger'}
            aria-label={props.triggerLabel}
            tabIndex={0}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setOpen(true);
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
        <Combobox.Content
          class="menu-surface size-auto z-action-menu menu-open-animation w-full max-w-76"
          as={Surface}
          depth={3}
          on:keydown={handleKeyDown}
          onCloseAutoFocus={(event: Event) => {
            if (focusOnClose?.isConnected) event.preventDefault();
          }}
        >
          <WithCustomDateMode
            selectedDate={selectedDate()}
            disablePriorToDate={props.disablePriorToDate}
            disableAfterDate={props.disableAfterDate}
            mode={mode()}
            onSelectDate={(date) => {
              fireAndForget(
                onChange({ type: 'custom', date }),
                'email-compose'
              );
            }}
          >
            <div class="flex w-full items-center py-2 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="size-4 text-ink-muted" />
              <Combobox.Input
                ref={(el) => {
                  setSearchInputRef(el);
                  // Keys typed right after Cmd+Shift+L belong to the search,
                  // not the editor that still has focus. Kobalte re-creates
                  // the input while handling Escape, so check it is still open.
                  if (isTouchDevice()) return;
                  queueMicrotask(() => {
                    if (isOpen()) el.focus({ preventScroll: true });
                  });
                }}
                class="w-full caret-accent"
                autofocus
              />
            </div>

            <Show
              when={
                props.showCurrentValue !== false || props.clearable !== false
              }
            >
              <Show when={selectedOption()}>
                {(option) => (
                  <CurrentValueDisplay
                    selectedOption={option()}
                    clearLabel={props.clearLabel}
                    currentLabel={props.currentLabel}
                    showValue={props.showCurrentValue !== false}
                    clearable={props.clearable !== false}
                    onClear={() => {
                      fireAndForget(onChange(null), 'email-compose');
                    }}
                  />
                )}
              </Show>
            </Show>
            <div class="p-1.5">
              <div class="max-h-56 overflow-y-auto overflow-x-hidden scrollbar-hidden">
                <Show when={timeOptions().length === 0}>
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
                <Combobox.Listbox
                  ref={(el) => {
                    setListboxRef(el);
                    highlightFirstMenuItemOnOpen(el);
                  }}
                />
              </div>
            </div>
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
                <code class="bg-active px-1">tom 5</code>,{' '}
                <code class="bg-active px-1">fri 9am</code>,{' '}
                <code class="bg-active px-1">in 2h</code>, or{' '}
                <code class="bg-active px-1">feb 17</code>
              </div>
            </div>
            <Show when={props.footer}>
              <div class="border-t border-edge-muted p-1.5">{props.footer}</div>
            </Show>
          </WithCustomDateMode>
        </Combobox.Content>
      </DateSelectorPortalWrapper>
    </Combobox>
  );
};

interface CurrentValueDisplayProps {
  selectedOption: DateSelectorOption;
  onClear: VoidFunction;
  clearLabel?: string;
  currentLabel?: string;
  showValue: boolean;
  clearable: boolean;
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
    <div class="border-b border-edge-muted p-1.5">
      <div class="flex items-center justify-between gap-3">
        <Show when={props.showValue}>
          <div class="flex min-w-0 flex-1 items-center gap-2 px-1.5">
            <span class="shrink-0 text-xs text-ink-muted">
              {props.currentLabel ?? 'Current:'}
            </span>
            <span class="min-w-0 truncate text-xs font-medium">
              {currentDateDisplay()}
            </span>
          </div>
        </Show>
        <Show when={props.clearable}>
          <button
            onPointerDown={(e: PointerEvent) => e.preventDefault()}
            onClick={props.onClear}
            class="min-h-10 shrink-0 rounded-lg px-3 text-xs text-ink-muted underline hover:bg-hover hover:text-ink"
            classList={{ 'w-full text-left': !props.showValue }}
          >
            {props.clearLabel ?? 'Clear'}
          </button>
        </Show>
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

    if (item.type === 'option') return item.label;

    return 'Custom date...';
  };

  const description = () => {
    const item = props.item.rawValue;

    if (item.type === 'option')
      return format(
        item.date,
        differenceInCalendarDays(item.date, new Date()) < 7
          ? 'EEE, h:mm a'
          : 'MMM d, h:mm a'
      );
    return 'Pick from calendar';
  };

  const presetNumber = () => {
    const item = props.item.rawValue;
    return item.type === 'option' ? item.presetNumber : undefined;
  };

  const item = () => (
    <Combobox.Item
      item={props.item}
      class="group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default outline-none data-highlighted:bg-hover"
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
      <Show when={presetNumber()}>
        {(number) => (
          <Hotkey
            shortcut={`opt+${number()}`}
            theme="subtle"
            class="touch:hidden"
          />
        )}
      </Show>
    </Combobox.Item>
  );

  return (
    <Show when={props.item.rawValue.type === 'select-custom'} fallback={item()}>
      <div class="border-t border-edge-muted mt-1.5 pt-1.5">{item()}</div>
    </Show>
  );
};
