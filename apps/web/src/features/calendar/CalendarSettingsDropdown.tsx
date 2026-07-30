import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type {
  CalendarSource,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './events/types';

interface CalendarSettingsDropdownProps {
  sources: CalendarSource[];
  isSourceVisible: (sourceId: string) => boolean;
  showCalendarVisibility: boolean;
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
  onSourceVisibilityChange: (sourceId: string, visible: boolean) => void;
  onShowWeekendsChange: (showWeekends: boolean) => void;
  onWeekStartsOnChange: (weekStartsOn: CalendarWeekStart) => void;
  onTimeFormatChange: (timeFormat: CalendarTimeFormat) => void;
}

const WEEK_START_OPTIONS: Array<{
  value: CalendarWeekStart;
  label: string;
}> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const TIME_FORMAT_OPTIONS: Array<{
  value: CalendarTimeFormat;
  label: string;
}> = [
  { value: '12-hour', label: '12-hour' },
  { value: '24-hour', label: '24-hour' },
];

/** Calendar display settings with source visibility on narrow layouts. */
export function CalendarSettingsDropdown(props: CalendarSettingsDropdownProps) {
  const weekStartLabel = () =>
    WEEK_START_OPTIONS.find((option) => option.value === props.weekStartsOn)
      ?.label ?? 'Sunday';
  const timeFormatLabel = () =>
    TIME_FORMAT_OPTIONS.find((option) => option.value === props.timeFormat)
      ?.label ?? '12-hour';

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        class="h-7 w-7 shrink-0 rounded-lg"
        label="Calendar settings"
      >
        <GearIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
        <Show when={props.showCalendarVisibility}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Calendars</Dropdown.GroupLabel>
            <For each={props.sources}>
              {(source) => (
                <Dropdown.CheckboxItem
                  checked={props.isSourceVisible(source.id)}
                  closeOnSelect={false}
                  onChange={(checked) =>
                    props.onSourceVisibilityChange(source.id, checked)
                  }
                >
                  <span
                    aria-hidden="true"
                    class="size-2.5 shrink-0 rounded-sm"
                    style={{ 'background-color': source.color }}
                  />
                  <span class="min-w-0 flex-1 truncate">{source.name}</span>
                </Dropdown.CheckboxItem>
              )}
            </For>
          </Dropdown.Group>
        </Show>

        <Dropdown.Group>
          <Dropdown.GroupLabel>Display</Dropdown.GroupLabel>
          <Dropdown.CheckboxItem
            checked={props.showWeekends}
            closeOnSelect={false}
            onChange={props.onShowWeekendsChange}
          >
            <span class="flex-1 truncate">Show weekends</span>
          </Dropdown.CheckboxItem>

          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                Week starts on
              </span>
              <span class="text-sm font-medium text-ink">
                {weekStartLabel()}
              </span>
              <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-36">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={String(props.weekStartsOn)}
                  onChange={(value) =>
                    props.onWeekStartsOnChange(
                      Number(value) as CalendarWeekStart
                    )
                  }
                >
                  <For each={WEEK_START_OPTIONS}>
                    {(option) => (
                      <Dropdown.RadioItem
                        closeOnSelect
                        value={String(option.value)}
                      >
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>

          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                Time format
              </span>
              <span class="text-sm font-medium text-ink">
                {timeFormatLabel()}
              </span>
              <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-36">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={props.timeFormat}
                  onChange={(value) =>
                    props.onTimeFormatChange(value as CalendarTimeFormat)
                  }
                >
                  <For each={TIME_FORMAT_OPTIONS}>
                    {(option) => (
                      <Dropdown.RadioItem closeOnSelect value={option.value}>
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
