import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import CopyIcon from '@phosphor/copy.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import XIcon from '@phosphor/x.svg';
import {
  ActionDialogShell,
  Button,
  cn,
  Dialog,
  type ManagedDialogProps,
  ToggleSwitch,
  Tooltip,
} from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import {
  AVAILABILITY_RANGE_OPTIONS,
  type AvailabilityRangeKey,
  formatAvailabilityText,
} from './availability';
import {
  getPersistedCalendarTimeFormat,
  useAvailabilitySettings,
} from './settings';
import { useAvailabilityRanges } from './use-availability-ranges';

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
  const { settings, setStartTime, setEndTime, setExcludeWeekends } =
    useAvailabilitySettings();
  const availability = useAvailabilityRanges(settings);
  let disposed = false;
  let resetCopied: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    disposed = true;
    clearTimeout(resetCopied);
  });

  const copyRange = async (rangeKey: AvailabilityRangeKey) => {
    if (disposed || copying()) return;
    if (!availability.days()?.[rangeKey]?.length) return;
    clearTimeout(resetCopied);
    setCopiedRange(undefined);
    setCopying(rangeKey);
    try {
      let latest;
      try {
        latest = await availability.refreshRange(rangeKey);
      } catch {
        if (!disposed) toast.failure('Failed to load availability');
        return;
      }
      if (disposed) return;
      if (!latest) {
        toast.alert('Calendar is still syncing. Try again shortly.');
        return;
      }
      if (!latest.days.length) {
        toast.alert('No free time in that range');
        return;
      }

      try {
        const text = formatAvailabilityText(
          latest.days,
          getPersistedCalendarTimeFormat(),
          latest.now
        );
        const copied = await writeClipboardData({ 'text/plain': text });
        if (disposed) return;
        if (copied) {
          setCopiedRange(rangeKey);
          resetCopied = setTimeout(() => setCopiedRange(undefined), 2500);
        } else {
          toast.failure('Failed to copy availability');
        }
      } catch {
        if (!disposed) toast.failure('Failed to copy availability');
      }
    } finally {
      if (!disposed) setCopying(undefined);
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
                <span class="relative block">
                  <select
                    class="settings-input w-full appearance-none pr-9 text-sm text-ink hover:border-edge-button hover:bg-hover"
                    value={settings().startTime}
                    onChange={(event) =>
                      setStartTime(event.currentTarget.value)
                    }
                  >
                    <For each={START_TIME_OPTIONS}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </select>
                  <CaretDownIcon
                    aria-hidden="true"
                    class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  />
                </span>
              </label>
              <label class="flex min-w-32 flex-1 flex-col gap-2 text-sm font-medium text-ink-muted">
                End time
                <span class="relative block">
                  <select
                    class="settings-input w-full appearance-none pr-9 text-sm text-ink hover:border-edge-button hover:bg-hover"
                    value={settings().endTime}
                    onChange={(event) => setEndTime(event.currentTarget.value)}
                  >
                    <For each={END_TIME_OPTIONS}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </select>
                  <CaretDownIcon
                    aria-hidden="true"
                    class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  />
                </span>
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
          <Show when={availability.isError()}>
            <div
              role="alert"
              class="flex w-full items-center justify-between gap-2 text-sm text-ink-muted"
            >
              Could not load availability.
              <Button variant="outline" size="sm" onClick={availability.retry}>
                Retry
              </Button>
            </div>
          </Show>
          <For each={AVAILABILITY_RANGE_OPTIONS}>
            {(option) => {
              const copied = () => copiedRange() === option.key;
              const unavailable = () =>
                availability.days()?.[option.key]?.length === 0;
              const disabled = () =>
                copying() !== undefined ||
                !availability.days()?.[option.key]?.length;
              const reason = () => {
                if (availability.isError())
                  return 'Could not check availability';
                if (!availability.days()) return 'Checking availability…';
                if (unavailable()) return 'No free time in this range';
                return '';
              };
              const isCopying = () => copying() === option.key;
              return (
                <Tooltip
                  as="span"
                  class="min-w-32 flex-1 flex-col rounded-lg focus-visible:ring-2 focus-visible:ring-edge-focus"
                  label={reason()}
                  disabled={!reason()}
                  tabIndex={unavailable() ? 0 : undefined}
                >
                  <Button
                    variant="outline"
                    size="md"
                    class={cn(
                      'w-full rounded-full px-2 disabled:cursor-not-allowed disabled:opacity-50',
                      isCopying() &&
                        'data-disabled:opacity-100 disabled:opacity-100'
                    )}
                    aria-label={
                      isCopying()
                        ? `Copying availability for ${option.label}`
                        : copied()
                          ? `${option.label} availability copied`
                          : `Copy availability for ${option.label}${reason() ? `: ${reason()}` : ''}`
                    }
                    aria-busy={isCopying()}
                    disabled={disabled()}
                    onClick={() => void copyRange(option.key)}
                  >
                    <span aria-hidden="true" class="grid place-items-center">
                      <span
                        class={cn(
                          'col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-200 motion-reduce:transition-none',
                          isCopying() || copied() ? 'opacity-0' : 'opacity-100',
                          unavailable() && 'touch:hidden'
                        )}
                      >
                        {option.label}
                        <CopyIcon class="size-4" />
                      </span>
                      <span
                        class={cn(
                          'col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-200 motion-reduce:transition-none',
                          isCopying() ? 'opacity-100' : 'opacity-0'
                        )}
                      >
                        <SpinnerIcon
                          class={cn(
                            'size-4 motion-reduce:animate-none',
                            isCopying() && 'animate-spin'
                          )}
                        />
                        Copying…
                      </span>
                      <span
                        class={cn(
                          'col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-200 motion-reduce:transition-none',
                          copied() && !isCopying() ? 'opacity-100' : 'opacity-0'
                        )}
                      >
                        Copied
                        <CheckIcon class="size-4 text-success" />
                      </span>
                      <Show when={unavailable()}>
                        <span class="col-start-1 row-start-1 hidden items-center justify-center gap-1.5 touch:flex">
                          {option.label}: No free time
                          <XIcon class="size-4" />
                        </span>
                      </Show>
                    </span>
                  </Button>
                </Tooltip>
              );
            }}
          </For>
          <span role="status" class="sr-only">
            {copying()
              ? 'Copying availability'
              : copiedRange()
                ? 'Availability copied'
                : ''}
          </span>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
