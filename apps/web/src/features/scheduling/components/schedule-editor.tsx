import { Popover } from '@kobalte/core/popover';
import ArrowLeft from '@phosphor/arrow-left.svg';
import Copy from '@phosphor/copy.svg';
import Plus from '@phosphor/plus.svg';
import X from '@phosphor/x.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, For, Index, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import {
  type AvailabilitySchedule,
  type TimeWindow,
  validateSchedule,
  WEEKDAYS,
} from '../core/types';
import { CheckField, Field, TextInput, TimeZoneInput } from './fields';

function nextWindow(windows: TimeWindow[]): TimeWindow {
  const last = windows.at(-1);
  if (!last) return { start: '09:00', end: '17:00' };
  const [h, m] = last.end.split(':').map(Number);
  const end = Math.min(h * 60 + m + 60, 1439);
  return {
    start: last.end,
    end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
  };
}
function Windows(props: {
  label: string;
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Index each={props.windows}>
        {(window, i) => (
          <div class="flex min-w-0 items-center gap-2">
            <TextInput
              type="time"
              class="w-28 shrink-0 px-2 @min-[560px]:w-32"
              aria-label={`${props.label} start ${i + 1}`}
              required
              value={window().start}
              onInput={(e) =>
                props.onChange(
                  props.windows.map((w, j) =>
                    j === i ? { ...w, start: e.currentTarget.value } : w
                  )
                )
              }
            />
            <span class="text-ink-muted">–</span>
            <TextInput
              type="time"
              class="w-28 shrink-0 px-2 @min-[560px]:w-32"
              aria-label={`${props.label} end ${i + 1}`}
              required
              value={window().end}
              onInput={(e) =>
                props.onChange(
                  props.windows.map((w, j) =>
                    j === i ? { ...w, end: e.currentTarget.value } : w
                  )
                )
              }
            />
            <Button
              variant="ghost"
              size="icon-md"
              label={`Remove ${props.label} range ${i + 1}`}
              onClick={() =>
                props.onChange(props.windows.filter((_, j) => j !== i))
              }
            >
              <X class="size-4" />
            </Button>
          </div>
        )}
      </Index>
    </div>
  );
}
function CopyHours(props: {
  day: number;
  disabled: boolean;
  onCopy: (days: number[]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [days, setDays] = createSignal<number[]>([]);
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setDays([]);
      }}
      placement="bottom-end"
      gutter={8}
    >
      <Popover.Trigger
        as={Button}
        variant="outline"
        depth={2}
        size="icon-md"
        disabled={props.disabled}
        label={`Copy ${WEEKDAYS[props.day]} hours`}
      >
        <Copy class="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu w-56 rounded-xl border border-edge bg-menu p-4 text-ink shadow-xl">
          <h4 class="mb-3 text-sm font-semibold">Copy times to</h4>
          <div class="flex flex-col gap-3">
            <For
              each={WEEKDAYS.map((name, day) => ({ name, day })).filter(
                (d) => d.day !== props.day
              )}
            >
              {(d) => (
                <CheckField
                  label={d.name}
                  checked={days().includes(d.day)}
                  onChange={(checked) =>
                    setDays(
                      checked
                        ? [...days(), d.day]
                        : days().filter((day) => day !== d.day)
                    )
                  }
                />
              )}
            </For>
          </div>
          <Button
            class="mt-4 w-full"
            variant="strong"
            disabled={!days().length}
            onClick={() => {
              props.onCopy(days());
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
export function ScheduleEditor(props: {
  schedule: AvailabilitySchedule;
  saving: boolean;
  onSave: (s: AvailabilitySchedule) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal(
    structuredClone(unwrap(props.schedule))
  );
  const [error, setError] = createSignal('');
  const remembered = new Map<number, TimeWindow[]>();
  const setDay = (day: number, windows: TimeWindow[]) =>
    setDraft((d) => ({
      ...d,
      weekly: d.weekly.map((w) => (w.day === day ? { ...w, windows } : w)),
    }));
  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    const message = validateSchedule(draft());
    setError(message ?? '');
    if (message) return;
    try {
      await props.onSave(draft());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save schedule.');
    }
  };
  return (
    <form class="flex flex-col gap-6" onSubmit={(e) => void save(e)}>
      <h1 class="sr-only">Edit availability schedule</h1>
      <div class="sticky top-0 z-10 flex items-center gap-3 bg-panel py-3">
        <Button
          variant="ghost"
          size="icon-md"
          label="Back to availability"
          onClick={props.onCancel}
        >
          <ArrowLeft class="size-5" />
        </Button>
        <TextInput
          aria-label="Schedule name"
          required
          value={draft().name}
          class="h-10 flex-1 border-transparent bg-transparent px-2 text-xl font-semibold focus-visible:border-edge"
          onInput={(e) =>
            setDraft((d) => ({ ...d, name: e.currentTarget.value }))
          }
        />
        <Button type="submit" variant="strong" disabled={props.saving}>
          {props.saving ? 'Saving…' : 'Save schedule'}
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure">
          {error()}
        </p>
      </Show>
      <section class="overflow-hidden rounded-xl border border-edge-muted bg-surface-1">
        <div class="border-b border-edge-muted bg-surface-2 px-5 py-5">
          <h3 class="font-semibold">Weekly hours</h3>
          <p class="mt-1 text-sm text-ink-muted">
            Set the times you are available each day.
          </p>
        </div>
        <div class="divide-y divide-edge-muted">
          <Index each={draft().weekly}>
            {(day) => (
              <div class="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-3 px-5 py-4 @min-[720px]:grid-cols-[160px_1fr_auto]">
                <ToggleSwitch
                  size="md"
                  class="min-h-10 gap-3"
                  labelClass="text-sm font-medium"
                  controlClass="data-checked:bg-ink"
                  label={WEEKDAYS[day().day]}
                  checked={!!day().windows.length}
                  onChange={(checked) => {
                    if (!checked) remembered.set(day().day, day().windows);
                    setDay(
                      day().day,
                      checked
                        ? (remembered.get(day().day) ?? [
                            { start: '09:00', end: '17:00' },
                          ])
                        : []
                    );
                  }}
                />
                <div class="col-span-2 row-start-2 @min-[720px]:col-span-1 @min-[720px]:col-start-2 @min-[720px]:row-start-1">
                  <Show
                    when={day().windows.length}
                    fallback={
                      <p class="flex h-10 items-center text-sm text-ink-muted">
                        Unavailable
                      </p>
                    }
                  >
                    <Windows
                      label={WEEKDAYS[day().day]}
                      windows={day().windows}
                      onChange={(windows) => setDay(day().day, windows)}
                    />
                  </Show>
                </div>
                <div class="col-start-2 row-start-1 flex h-10 items-center gap-2 @min-[720px]:col-start-3">
                  <Button
                    variant="outline"
                    depth={2}
                    size="icon-md"
                    label={`Add ${WEEKDAYS[day().day]} hours`}
                    disabled={
                      day().windows.length >= 8 ||
                      day().windows.at(-1)?.end === '23:59'
                    }
                    onClick={() =>
                      setDay(day().day, [
                        ...day().windows,
                        nextWindow(day().windows),
                      ])
                    }
                  >
                    <Plus class="size-4" />
                  </Button>
                  <CopyHours
                    day={day().day}
                    disabled={!day().windows.length}
                    onCopy={(days) =>
                      setDraft((d) => ({
                        ...d,
                        weekly: d.weekly.map((w) =>
                          days.includes(w.day)
                            ? {
                                ...w,
                                windows: structuredClone(unwrap(day().windows)),
                              }
                            : w
                        ),
                      }))
                    }
                  />
                </div>
              </div>
            )}
          </Index>
        </div>
      </section>
      <section class="overflow-hidden rounded-xl border border-edge-muted bg-surface-1">
        <div class="flex flex-wrap items-center justify-between gap-4 bg-surface-2 px-5 py-5">
          <div>
            <h3 class="font-semibold">Date overrides</h3>
            <p class="mt-1 text-sm text-ink-muted">
              Adjust your hours for a specific date or take a day off.
            </p>
          </div>
          <Button
            variant="outline"
            depth={2}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                overrides: [...d.overrides, { date: '', windows: [] }],
              }))
            }
          >
            <Plus class="size-4" />
            Add date override
          </Button>
        </div>
        <Index each={draft().overrides}>
          {(override, index) => (
            <div class="flex flex-col gap-4 border-t border-edge-muted px-5 py-4">
              <div class="flex items-center justify-between gap-3">
                <TextInput
                  class="max-w-48"
                  type="date"
                  required
                  aria-label="Override date"
                  value={override().date}
                  onInput={(e) =>
                    setDraft((d) => ({
                      ...d,
                      overrides: d.overrides.map((o, i) =>
                        i === index ? { ...o, date: e.currentTarget.value } : o
                      ),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-md"
                  label="Remove date override"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      overrides: d.overrides.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <X class="size-4" />
                </Button>
              </div>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <Show
                  when={override().windows.length}
                  fallback={
                    <p class="py-2 text-sm text-ink-muted">
                      Unavailable all day
                    </p>
                  }
                >
                  <Windows
                    label={override().date || 'Override'}
                    windows={override().windows}
                    onChange={(windows) =>
                      setDraft((d) => ({
                        ...d,
                        overrides: d.overrides.map((o, i) =>
                          i === index ? { ...o, windows } : o
                        ),
                      }))
                    }
                  />
                </Show>
                <Button
                  variant="outline"
                  depth={2}
                  disabled={
                    override().windows.length >= 8 ||
                    override().windows.at(-1)?.end === '23:59'
                  }
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      overrides: d.overrides.map((o, i) =>
                        i === index
                          ? {
                              ...o,
                              windows: [...o.windows, nextWindow(o.windows)],
                            }
                          : o
                      ),
                    }))
                  }
                >
                  <Plus class="size-4" />
                  Set hours
                </Button>
              </div>
            </div>
          )}
        </Index>
      </section>
      <Field
        label="Time zone"
        class="max-w-sm"
        hint="Your weekly hours and date overrides use this time zone."
      >
        <TimeZoneInput
          value={draft().timeZone}
          onChange={(timeZone) => setDraft((d) => ({ ...d, timeZone }))}
        />
      </Field>
    </form>
  );
}
