import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import CopyIcon from '@phosphor/copy.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dialog, Panel, ToggleSwitch } from '@ui';
import { createSignal, For, Show } from 'solid-js';
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

/** Opens the shared availability dialog from a header or compact action. */
export function CopyAvailabilityButton(props: {
  class?: string;
  iconOnly?: boolean;
  largeIcon?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [copying, setCopying] = createSignal<AvailabilityRangeKey>();
  const getAvailabilityText = useAvailabilityText();
  const { settings, setStartTime, setEndTime, setExcludeWeekends } =
    useAvailabilitySettings();
  // Without a calendar-connected inbox every range would read as fully free.
  const connectedInboxes = useCalendarConnectedInboxes();

  const copyRange = async (rangeKey: AvailabilityRangeKey) => {
    if (copying()) return;
    setCopying(rangeKey);
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
    } finally {
      setCopying(undefined);
    }
  };

  return (
    <Show when={connectedInboxes().length > 0}>
      <Button
        variant="ghost"
        size={props.iconOnly ? (props.largeIcon ? 'icon-md' : 'icon-sm') : 'sm'}
        class={cn(
          props.iconOnly &&
            (props.largeIcon
              ? 'rounded-full border-transparent bg-transparent'
              : 'size-(--sidebar-control-size) rounded-lg border-transparent bg-transparent'),
          !props.iconOnly && 'shrink-0 gap-1.5 rounded-lg px-2',
          props.class
        )}
        aria-label="Copy availability"
        tooltip={props.iconOnly ? 'Copy availability' : undefined}
        onClick={() => setOpen(true)}
      >
        <CalendarCheckIcon
          class={
            props.largeIcon
              ? 'size-4'
              : props.iconOnly
                ? 'size-3.5'
                : 'size-4 shrink-0'
          }
        />
        <Show when={!props.iconOnly}>
          <span class="truncate">Copy availability</span>
        </Show>
      </Button>
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        position="center"
        class="w-160"
      >
        <Panel depth={2} class="rounded-xl">
          <Panel.Header class="justify-between gap-3 border-0 px-5 py-2">
            <Dialog.Title class="text-base font-semibold text-ink">
              Copy availability
            </Dialog.Title>
            <Button
              variant="navigation"
              size="icon-sm"
              label="Close availability dialog"
              onClick={() => setOpen(false)}
            >
              <XIcon class="size-4" />
            </Button>
          </Panel.Header>
          <Panel.Body class="flex flex-col gap-5 p-5">
            <div class="flex flex-col gap-3">
              <h3 class="text-sm font-medium text-ink">Availability settings</h3>
              <div class="flex flex-wrap items-end gap-3">
                <label class="flex min-w-32 flex-1 flex-col gap-1 text-xs text-ink-muted">
                  Start time
                  <select
                    class="settings-input h-9 w-full rounded-lg px-2 text-sm text-ink"
                    value={settings().startTime}
                    onChange={(event) => setStartTime(event.currentTarget.value)}
                  >
                    <For each={START_TIME_OPTIONS}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="flex min-w-32 flex-1 flex-col gap-1 text-xs text-ink-muted">
                  End time
                  <select
                    class="settings-input h-9 w-full rounded-lg px-2 text-sm text-ink"
                    value={settings().endTime}
                    onChange={(event) => setEndTime(event.currentTarget.value)}
                  >
                    <For each={END_TIME_OPTIONS}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
              </div>
              <ToggleSwitch
                size="md"
                label="Exclude weekends"
                checked={settings().excludeWeekends}
                onChange={setExcludeWeekends}
              />
            </div>
            <div class="flex gap-2 overflow-x-auto pb-1">
              <For each={AVAILABILITY_RANGE_OPTIONS}>
                {(option) => (
                  <Button
                    variant="outline"
                    size="md"
                    class="min-w-28 flex-1 gap-1.5 rounded-full px-2"
                    aria-label={`Copy availability for ${option.label}`}
                    disabled={copying() !== undefined}
                    onClick={() => void copyRange(option.key)}
                  >
                    {copying() === option.key ? 'Copying…' : option.label}
                    <CopyIcon class="size-4" />
                  </Button>
                )}
              </For>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </Show>
  );
}
