import { useSidePanel } from '@components/app/side-panel/SidePanel';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import { Dropdown } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { useCalendarView } from './CalendarViewContext';
import type { CalendarTimeFormat, CalendarWeekStart } from './events/types';

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

/** Calendar display settings. */
export function CalendarSettingsDropdown() {
  const calendarView = useCalendarView();
  const sidePanel = useSidePanel();

  const showCalendarVisibility = () =>
    (sidePanel?.isNarrow() ?? false) && calendarView.sources().length > 1;

  const weekStartLabel = createMemo(
    () =>
      WEEK_START_OPTIONS.find(
        (option) => option.value === calendarView.displaySettings.weekStartsOn
      )?.label ?? 'Sunday'
  );

  const timeFormatLabel = createMemo(
    () =>
      TIME_FORMAT_OPTIONS.find(
        (option) => option.value === calendarView.displaySettings.timeFormat
      )?.label ?? '12-hour'
  );

  const changeSourceVisibility = (sourceId: string, visible: boolean) => {
    calendarView.closeEventDetails();
    calendarView.setSourceVisibility(sourceId, visible);
  };

  const changeShowWeekends = (showWeekends: boolean) => {
    calendarView.closeEventDetails();
    calendarView.setShowWeekends(showWeekends);
  };

  const changeWeekStartsOn = (weekStartsOn: CalendarWeekStart) => {
    calendarView.closeEventDetails();
    calendarView.setWeekStartsOn(weekStartsOn);
  };

  const changeTimeFormat = (timeFormat: CalendarTimeFormat) => {
    calendarView.closeEventDetails();
    calendarView.setTimeFormat(timeFormat);
  };

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        class="shrink-0 rounded-lg"
        label="Calendar settings"
      >
        <GearIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
        <Show when={showCalendarVisibility()}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Calendars</Dropdown.GroupLabel>
            <For each={calendarView.sources()}>
              {(source) => (
                <Dropdown.CheckboxItem
                  checked={calendarView.isSourceVisible(source.id)}
                  closeOnSelect={false}
                  onChange={(checked) =>
                    changeSourceVisibility(source.id, checked)
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
            checked={calendarView.displaySettings.showWeekends}
            closeOnSelect={false}
            onChange={changeShowWeekends}
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
                  value={String(calendarView.displaySettings.weekStartsOn)}
                  onChange={(value) =>
                    changeWeekStartsOn(Number(value) as CalendarWeekStart)
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
                  value={calendarView.displaySettings.timeFormat}
                  onChange={(value) =>
                    changeTimeFormat(value as CalendarTimeFormat)
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
