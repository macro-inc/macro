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
import { useKeyPressed } from '@core/util/useKeyPressed';
import { Combobox } from '@kobalte/core/combobox';
import { cn } from '@ui/utils/classname';

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
    createSignal<DateSelectorOption | null>(null);

  const [searchQuery, setSearchQuery] = createSignal('');
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

  const currentDateDisplay = createMemo(() => {
    // if (!props.selectedDate) return 'No date set';
    // try {
    //   return format(props.selectedDate, "MMMM d, yyyy 'at' h:mm a");
    // } catch {
    //   return 'Invalid date';
    // }
  });

  const handleCalendarChange = (date: Date) => {
    // handleSelectDate(date);
  };

  const options = createMemo(() => {
    return [
      ...dateOptions().map((o) => ({ custom: false, context: o }) as const),
      { custom: true, date: new Date() } as const,
    ];
  });

  return (
    <Combobox<DateSelectorOption>
      multiple={false}
      options={options()}
      optionValue={(o) =>
        o.custom ? o.date.toString() : o.context.date.toString()
      }
      optionTextValue={(o) =>
        o.custom ? 'Custom date' : o.context.displayText
      }
      onChange={setSelectedOption}
      onInputChange={setSearchQuery}
      allowsEmptyCollection
      placement="bottom-start"
      placeholder="Search dates"
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
            <Combobox.Input />
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
