import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { Button, Dropdown } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { CalendarEvent, CalendarSource } from './types';

const padDatePart = (value: number) => String(value).padStart(2, '0');

const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}`;

const parseLocalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return formatLocalDate(date) === value ? date : undefined;
};

const shiftLocalDate = (value: string, days: number) => {
  const date = parseLocalDate(value);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
};

const formatLocalDateTime = (value: string) => {
  const date = new Date(value);
  return `${formatLocalDate(date)}T${padDatePart(date.getHours())}:${padDatePart(
    date.getMinutes()
  )}`;
};

const toComparableTime = (value: string, allDay: boolean) =>
  allDay
    ? (parseLocalDate(value)?.getTime() ?? Number.NaN)
    : new Date(value).getTime();

interface EventEditorProps {
  event: CalendarEvent;
  sources: CalendarSource[];
  onCancel: () => void;
  onSave: (event: CalendarEvent) => void;
}

/** Edits a newly drawn event before it is committed to local calendar state. */
export function EventEditor(props: EventEditorProps) {
  const [title, setTitle] = createSignal('');
  const [sourceId, setSourceId] = createSignal(props.event.calendar.id);
  const [start, setStart] = createSignal(
    props.event.allDay
      ? props.event.start
      : formatLocalDateTime(props.event.start)
  );
  const [end, setEnd] = createSignal(
    props.event.allDay
      ? shiftLocalDate(props.event.end, -1)
      : formatLocalDateTime(props.event.end)
  );
  let titleInput: HTMLInputElement | undefined;
  let editorClosed = false;

  const selectedSource = () =>
    props.sources.find((source) => source.id === sourceId()) ??
    props.event.calendar;
  const canSave = createMemo(() => {
    const startTime = toComparableTime(start(), props.event.allDay);
    const endTime = toComparableTime(end(), props.event.allDay);
    return (
      title().trim().length > 0 &&
      Number.isFinite(startTime) &&
      Number.isFinite(endTime) &&
      (props.event.allDay ? endTime >= startTime : endTime > startTime)
    );
  });

  const cancel = () => {
    editorClosed = true;
    props.onCancel();
  };

  const save = () => {
    if (!canSave()) return;
    editorClosed = true;
    props.onSave({
      ...props.event,
      title: title().trim(),
      calendar: selectedSource(),
      start: props.event.allDay ? start() : new Date(start()).toISOString(),
      end: props.event.allDay
        ? shiftLocalDate(end(), 1)
        : new Date(end()).toISOString(),
    });
  };

  onMount(() => titleInput?.focus());
  onCleanup(() => {
    if (!editorClosed) props.onCancel();
  });

  return (
    <form
      class="flex min-w-0 flex-col gap-3 p-1 text-ink"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-muted">Title</span>
        <input
          ref={titleInput}
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
          placeholder="Event title"
          class="h-8 rounded-lg border border-edge-muted bg-surface px-2 text-sm text-ink outline-none placeholder:text-ink-extra-muted focus:border-accent"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-muted">Calendar</span>
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger class="h-8 w-full justify-start gap-2 rounded-lg bg-surface px-2 text-sm text-ink">
            <span
              aria-hidden="true"
              class="size-2.5 shrink-0 rounded-sm"
              style={{ 'background-color': selectedSource().color }}
            />
            <span class="min-w-0 flex-1 truncate text-left">
              {selectedSource().name}
            </span>
            <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-48">
            <Dropdown.Group>
              <Dropdown.RadioGroup value={sourceId()} onChange={setSourceId}>
                <For each={props.sources}>
                  {(source) => (
                    <Dropdown.RadioItem closeOnSelect value={source.id}>
                      <span
                        aria-hidden="true"
                        class="size-2.5 shrink-0 rounded-sm"
                        style={{ 'background-color': source.color }}
                      />
                      <span class="min-w-0 flex-1 truncate">{source.name}</span>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="size-3.5 text-accent" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                  )}
                </For>
              </Dropdown.RadioGroup>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </label>

      <div class="grid grid-cols-2 gap-2">
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-xs text-ink-muted">Starts</span>
          <input
            type={props.event.allDay ? 'date' : 'datetime-local'}
            value={start()}
            onInput={(event) => setStart(event.currentTarget.value)}
            class="h-8 min-w-0 rounded-lg border border-edge-muted bg-surface px-2 text-xs text-ink outline-none focus:border-accent"
          />
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="text-xs text-ink-muted">Ends</span>
          <input
            type={props.event.allDay ? 'date' : 'datetime-local'}
            value={end()}
            min={start()}
            onInput={(event) => setEnd(event.currentTarget.value)}
            class="h-8 min-w-0 rounded-lg border border-edge-muted bg-surface px-2 text-xs text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      <Show when={props.event.allDay}>
        <span class="text-xs text-ink-extra-muted">All-day event</span>
      </Show>

      <div class="mt-1 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" variant="cta" size="sm" disabled={!canSave()}>
          Save
        </Button>
      </div>
    </form>
  );
}
