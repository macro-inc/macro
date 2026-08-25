import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear.svg';
import { ButtonGroup, cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { useCalendarConnectedInboxes } from '../hooks/use-calendar-connected-inboxes';
import {
  AVAILABILITY_RANGE_OPTIONS,
  type AvailabilityRangeKey,
} from './availability';
import { useAvailabilitySettings } from './settings';
import { useAvailabilityText } from './use-availability-text';

interface TimeOption {
  value: string;
  label: string;
}

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** Half-hour choices between two local hours (inclusive). */
function timeOptions(fromHour: number, toHour: number): TimeOption[] {
  const options: TimeOption[] = [];
  for (let minutes = fromHour * 60; minutes <= toHour * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    options.push({
      value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      label: timeLabelFormatter.format(new Date(2000, 0, 1, hour, minute)),
    });
  }
  return options;
}

const START_TIME_OPTIONS = timeOptions(6, 12);
const END_TIME_OPTIONS = timeOptions(12, 22);

function timeOptionLabel(options: TimeOption[], value: string): string {
  const known = options.find((option) => option.value === value)?.label;
  if (known) return known;
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return timeLabelFormatter.format(new Date(2000, 0, 1, hour, minute));
}

function TimeRadioGroup(props: {
  options: TimeOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown.RadioGroup value={props.value} onChange={props.onChange}>
      <For each={props.options}>
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
  );
}

/**
 * Split control for sharing availability: the labeled half opens a range
 * menu ("Today" … "Next 14 days") that copies the viewer's free slots as
 * text; the gear half opens the feature's settings (workday start/end,
 * exclude weekends).
 */
export function CopyAvailabilityButton(props: { class?: string }) {
  const getAvailabilityText = useAvailabilityText();
  const { settings, setStartTime, setEndTime, setExcludeWeekends } =
    useAvailabilitySettings();
  // Without a calendar-connected inbox every range would read as fully
  // free, so the control offers nothing useful and stays hidden.
  const connectedInboxes = useCalendarConnectedInboxes();

  const startTimeLabel = () =>
    timeOptionLabel(START_TIME_OPTIONS, settings().startTime);
  const endTimeLabel = () =>
    timeOptionLabel(END_TIME_OPTIONS, settings().endTime);

  const copyRange = async (rangeKey: AvailabilityRangeKey) => {
    try {
      const text = await getAvailabilityText(rangeKey);
      if (!text) {
        toast.alert('No free time in that range');
        return;
      }
      if (await writeClipboardData({ 'text/plain': text })) {
        toast.success('Availability copied');
      } else {
        toast.failure('Failed to copy availability');
      }
    } catch {
      toast.failure('Failed to load availability');
    }
  };

  return (
    <Show when={connectedInboxes().length > 0}>
      <ButtonGroup
        variant="ghost"
        size="sm"
        class={cn('shrink-0 rounded-lg border border-edge-muted', props.class)}
      >
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger class="gap-1.5 bg-transparent px-2 hover:bg-ink/[0.04]">
            <CalendarCheckIcon class="size-3.5 shrink-0" />
            <span class="truncate text-xs font-medium">Copy availability</span>
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-40">
            <Dropdown.Group>
              <For each={AVAILABILITY_RANGE_OPTIONS}>
                {(option) => (
                  <Dropdown.Item
                    closeOnSelect
                    onSelect={() => void copyRange(option.key)}
                  >
                    <span class="flex-1 truncate">{option.label}</span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>

        <ButtonGroup.Divider />

        <Dropdown placement="bottom-end">
          <Dropdown.Trigger
            class="bg-transparent p-1 hover:bg-ink/[0.04]"
            label="Availability settings"
          >
            <GearIcon class="size-3.5" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-56 max-w-[calc(100vw-1rem)]">
            <Dropdown.Group>
              <Dropdown.GroupLabel>Availability</Dropdown.GroupLabel>
              <Dropdown.CheckboxItem
                checked={settings().excludeWeekends}
                closeOnSelect={false}
                onChange={setExcludeWeekends}
              >
                <span class="flex-1 truncate">Exclude weekends</span>
              </Dropdown.CheckboxItem>

              <Dropdown.Sub>
                <Dropdown.SubTrigger>
                  <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    Start time
                  </span>
                  <span class="text-sm font-medium text-ink">
                    {startTimeLabel()}
                  </span>
                  <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.SubTrigger>
                <Dropdown.SubContent class="max-h-72 min-w-36 overflow-y-auto">
                  <Dropdown.Group>
                    <TimeRadioGroup
                      options={START_TIME_OPTIONS}
                      value={settings().startTime}
                      onChange={setStartTime}
                    />
                  </Dropdown.Group>
                </Dropdown.SubContent>
              </Dropdown.Sub>

              <Dropdown.Sub>
                <Dropdown.SubTrigger>
                  <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    End time
                  </span>
                  <span class="text-sm font-medium text-ink">
                    {endTimeLabel()}
                  </span>
                  <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.SubTrigger>
                <Dropdown.SubContent class="max-h-72 min-w-36 overflow-y-auto">
                  <Dropdown.Group>
                    <TimeRadioGroup
                      options={END_TIME_OPTIONS}
                      value={settings().endTime}
                      onChange={setEndTime}
                    />
                  </Dropdown.Group>
                </Dropdown.SubContent>
              </Dropdown.Sub>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </ButtonGroup>
    </Show>
  );
}
