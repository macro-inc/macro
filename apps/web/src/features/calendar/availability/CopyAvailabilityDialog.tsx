import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import XIcon from '@phosphor/x.svg';
import {
  ActionDialogShell,
  Button,
  cn,
  Dialog,
  type ManagedDialogProps,
  ToggleSwitch,
} from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
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

/** Managed availability settings and click-to-copy ranges. */
export function CopyAvailabilityDialog(props: ManagedDialogProps) {
  const [copying, setCopying] = createSignal<AvailabilityRangeKey>();
  const [copiedRange, setCopiedRange] = createSignal<AvailabilityRangeKey>();
  const getAvailabilityText = useAvailabilityText();
  const { settings, setStartTime, setEndTime, setExcludeWeekends } =
    useAvailabilitySettings();
  let disposed = false;
  let resetCopied: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    disposed = true;
    clearTimeout(resetCopied);
  });

  const copyRange = async (rangeKey: AvailabilityRangeKey) => {
    if (disposed || copying()) return;
    clearTimeout(resetCopied);
    setCopiedRange(undefined);
    setCopying(rangeKey);
    try {
      const text = await getAvailabilityText(rangeKey);
      if (disposed) return;
      if (!text) {
        toast.alert('No free time in that range');
        return;
      }
      const copied = await writeClipboardData({ 'text/plain': text });
      if (disposed) return;
      if (copied) {
        setCopiedRange(rangeKey);
        resetCopied = setTimeout(() => setCopiedRange(undefined), 2500);
      } else {
        toast.failure('Failed to copy availability');
      }
    } catch {
      if (!disposed) {
        toast.failure('Failed to load availability');
      }
    } finally {
      if (!disposed) {
        setCopying(undefined);
      }
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-150"
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header class="flex items-start justify-between gap-3">
            <ActionDialogShell.Title>Copy availability</ActionDialogShell.Title>
            <Button
              variant="navigation"
              size="icon-sm"
              label="Close availability dialog"
              onClick={() => props.onOpenChange(false)}
            >
              <XIcon class="size-4" />
            </Button>
          </ActionDialogShell.Header>
          <section class="space-y-3">
            <h3 class="text-sm font-medium text-ink">Availability settings</h3>
            <div class="flex flex-wrap items-end gap-3">
              <label class="flex min-w-32 flex-1 flex-col gap-2 text-sm font-medium text-ink-muted">
                Start time
                <select
                  class="settings-input w-full text-sm text-ink"
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
              <label class="flex min-w-32 flex-1 flex-col gap-2 text-sm font-medium text-ink-muted">
                End time
                <select
                  class="settings-input w-full text-sm text-ink"
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
          </section>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer class="justify-start gap-2 py-5">
          <For each={AVAILABILITY_RANGE_OPTIONS}>
            {(option) => {
              const copied = () => copiedRange() === option.key;
              const label = () => {
                if (copying() === option.key) return 'Copying…';
                if (copied()) return 'Copied';
                return option.label;
              };
              return (
                <Button
                  variant={copied() ? 'success' : 'outline'}
                  size="md"
                  class={cn(
                    'min-w-32 flex-1 gap-1.5 rounded-full px-2',
                    copied() && 'border-success bg-success-bg'
                  )}
                  aria-label={
                    copied()
                      ? `${option.label} availability copied`
                      : `Copy availability for ${option.label}`
                  }
                  disabled={copying() !== undefined}
                  onClick={() => void copyRange(option.key)}
                >
                  {label()}
                  <Show when={copied()} fallback={<CopyIcon class="size-4" />}>
                    <CheckIcon class="size-4" />
                  </Show>
                </Button>
              );
            }}
          </For>
          <span role="status" class="sr-only">
            {copiedRange() ? 'Availability copied' : ''}
          </span>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
