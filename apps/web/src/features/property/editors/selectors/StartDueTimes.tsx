import {
  dayTimeOptions,
  endTimeOptions,
  matchTypedTime,
  parseTimeValue,
  type TimeOption,
  typedTimeOption,
} from '@app/components/date-time-range/time-options';
import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { useKeyPressed } from '@core/util/useKeyPressed';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { useSearchInputFocus } from '@property/utils/focus';
import { cn } from '@ui';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onMount,
  Show,
} from 'solid-js';
import {
  type DateField,
  pickTime,
  pickTimedDay,
  type StartDue,
} from '../../utils/start-due';

type StartDueTimesProps = {
  dates: StartDue;
  field: DateField;
  onFieldChange: (field: DateField) => void;
  hour12: boolean;
  onChange: (dates: StartDue, changed: DateField[]) => void;
  onClose?: () => void;
  fillHeight?: boolean;
  header: JSX.Element;
  footer: JSX.Element;
};

/**
 * The dates picker once its dates have times: the clock times for the
 * active end, typed or picked, and a calendar to move that end to another
 * day. Due times on the start's day count on from the start with the length
 * they give, as a calendar event's end times do, and a first start time falls
 * on the due date's day. A start time moves on to the due date and a due time
 * closes the picker. Mount it once per active end, so each starts on that
 * end's time with nothing typed.
 */
export function StartDueTimes(props: StartDueTimesProps) {
  const [query, setQuery] = createSignal('');
  const [showCalendar, setShowCalendar] = createSignal(false);
  // The row the arrows or the pointer moved to, over the typed or current one.
  const [moved, setMoved] = createSignal<string>();
  const keyboardMode = useKeyPressed(100);
  let input!: HTMLInputElement;
  let list: HTMLDivElement | undefined;

  const value = () => props.dates[props.field];

  // The day the listed times fall on, before an option's day offset. An end
  // not set yet takes the other end's day.
  const anchorDay = () => {
    const { start, due } = props.dates;
    if (props.field === 'due' && start && (!due || isSameDay(start, due))) {
      return startOfDay(start);
    }
    const other = props.field === 'start' ? due : start;
    return startOfDay(value() ?? other ?? new Date());
  };

  const options = createMemo<TimeOption[]>(() => {
    const { start, due, wholeDay } = props.dates;
    if (props.field === 'due' && start && (!due || isSameDay(start, due))) {
      const ends = endTimeOptions(format(start, 'HH:mm'), props.hour12);
      // Beside a date without a time there is no length to label times with.
      return wholeDay
        ? ends.map((option) => ({ ...option, detail: undefined }))
        : ends;
    }
    return dayTimeOptions(props.hour12);
  });

  const optionAt = (option: TimeOption) =>
    addDays(anchorDay(), option.dayOffset);

  // An end saved without a time has no current time, only the hour it is held at.
  const currentOption = () => {
    const at = value();
    if (!at || props.dates.wholeDay === props.field) return undefined;
    return options().find(
      (option) =>
        isSameDay(optionAt(option), at) && option.value === format(at, 'HH:mm')
    );
  };

  const typedMatch = () =>
    query().trim() ? matchTypedTime(options(), query()) : undefined;
  const highlighted = () => moved() ?? typedMatch()?.id ?? currentOption()?.id;

  const typeQuery = (text: string) => {
    setQuery(text);
    setMoved(undefined);
    scrollTo(typedMatch()?.id);
  };

  onMount(() => scrollTo(highlighted()));

  function scrollTo(id: string | undefined) {
    if (!id || !list) return;
    const rows = list.querySelectorAll<HTMLElement>('[data-time-id]');
    Array.from(rows)
      .find((row) => row.dataset.timeId === id)
      ?.scrollIntoView({ block: 'nearest' });
  }

  const pick = (option: TimeOption) => {
    const minutes = parseTimeValue(option.value);
    if (minutes === undefined) return;
    const picked = pickTime(
      props.dates,
      props.field,
      optionAt(option),
      minutes
    );
    props.onChange(picked.dates, picked.changed);
    if (props.field === 'start') {
      props.onFieldChange('due');
      return;
    }
    props.onClose?.();
  };

  const move = (step: number) => {
    const all = options();
    let index = all.findIndex((option) => option.id === highlighted());
    // With no row highlighted, Down starts at the first row and Up at the last.
    if (index < 0) index = step > 0 ? -1 : 0;
    const next = all[(index + step + all.length) % all.length];
    setMoved(next?.id);
    scrollTo(next?.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onClose?.();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const typed = query().trim();
      const chosen = options().find((candidate) => candidate.id === moved());
      const option =
        chosen ??
        (typed
          ? typedTimeOption(options(), typed, props.hour12)
          : options().find((candidate) => candidate.id === highlighted()));
      if (option) pick(option);
    }
  };

  const pickDay = (day: Date) => {
    const picked = pickTimedDay(props.dates, props.field, day);
    props.onChange(picked.dates, picked.changed);
    setShowCalendar(false);
  };

  useSearchInputFocus(() => input);
  const keepSearchFocus = (event: Event) => event.preventDefault();

  return (
    <div
      class={cn('relative flex min-h-0 flex-col', props.fillHeight && 'flex-1')}
    >
      {props.header}
      <div class="flex w-full shrink-0 items-center gap-2 border-b border-edge-muted px-2 py-2">
        <ClockIcon class="size-4 text-ink-muted" />
        <input
          ref={input}
          class="w-full caret-accent"
          type="text"
          value={query()}
          onInput={(event) => typeQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={
            props.field === 'start' ? 'Set start time...' : 'Set end time...'
          }
          disabled={showCalendar()}
        />
      </div>
      <div
        class="flex min-h-0 flex-1 flex-col p-1.5"
        onPointerDown={keepSearchFocus}
        onMouseDown={keepSearchFocus}
      >
        <Show
          when={!showCalendar()}
          fallback={
            <div class="flex min-h-0 justify-center overflow-y-auto">
              <DatePickerUI
                value={value() ?? props.dates.start ?? new Date()}
                range={{ start: props.dates.start, end: props.dates.due }}
                onChange={pickDay}
              />
            </div>
          }
        >
          <div
            ref={list}
            role="listbox"
            aria-label={props.field === 'start' ? 'Start time' : 'End time'}
            class={cn(
              'min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden',
              !props.fillHeight && 'max-h-50'
            )}
          >
            <For each={options()}>
              {(option) => (
                <div
                  role="option"
                  data-time-id={option.id}
                  aria-selected={option.id === currentOption()?.id}
                  class={cn(
                    'flex w-full items-center justify-between gap-1.5 rounded-lg p-1.5 px-2 text-left text-ink touch:min-h-12',
                    option.id === highlighted() && 'bg-hover'
                  )}
                  onClick={() => pick(option)}
                  onMouseEnter={() => {
                    if (!keyboardMode()) setMoved(option.id);
                  }}
                >
                  <span class="truncate">{option.label}</span>
                  <Show when={option.detail}>
                    <span class="text-xs text-ink-muted">{option.detail}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <div class="mt-1 border-t border-edge-muted pt-1">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg p-1.5 px-2 text-left text-ink not-touch:hover:bg-hover touch:min-h-12"
              onClick={() => setShowCalendar(true)}
            >
              <CalendarIcon class="size-4 text-ink-muted" />
              Change day
            </button>
          </div>
        </Show>
      </div>
      {props.footer}
    </div>
  );
}
