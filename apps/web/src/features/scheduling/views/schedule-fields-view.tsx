import ArrowsClockwise from '@phosphor/arrows-clockwise.svg';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import ArrowLeft from '@phosphor/caret-left.svg';
import ArrowRight from '@phosphor/caret-right.svg';
import Globe from '@phosphor/globe.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { Button, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { getDefaultCalendarTimeFormat } from '../../calendar/utils/time-format';
import {
  AvailabilityCalendar,
  type AvailabilityColumn,
} from '../components/availability-calendar';
import { AvailabilityExceptionDialog } from '../components/availability-exception-dialog';
import { AvailabilityFieldRow } from '../components/availability-field-row';
import { AvailabilityScheduleTitle } from '../components/availability-general-details';
import { AvailabilityHoursEditor } from '../components/availability-hours-editor';
import { AvailabilityHoursSummary } from '../components/availability-hours-summary';
import { AvailabilityMonthPicker } from '../components/availability-month-picker';
import { TimeZoneInput } from '../components/fields';
import { availabilityState, validAvailabilityDate } from '../core/availability';
import {
  type AvailabilityTimeFormat,
  availabilityMonth,
  formatAvailabilityDate,
  shiftAvailabilityMonth,
} from '../core/availability-month';
import { availabilityRuleHours } from '../core/availability-selection';
import { reportDate } from '../core/insights';
import { type AvailabilitySchedule, WEEKDAYS } from '../core/types';
import { createAvailabilityRules } from '../primitives/create-availability-rules';

/** Edit weekly rules and date exceptions, with a calendar preview of both. */
export function ScheduleFields(props: {
  schedule: AvailabilitySchedule;
  disabled?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onChange: (
    update: (current: AvailabilitySchedule) => AvailabilitySchedule
  ) => void;
}) {
  const [monthDate, setMonthDate] = createSignal(
    reportDate(new Date(), props.schedule.timeZone)
  );
  const [timeFormat, setTimeFormat] = createSignal<AvailabilityTimeFormat>(
    getDefaultCalendarTimeFormat() === '24-hour' ? '24h' : '12h'
  );
  const editor = createAvailabilityRules({
    schedule: () => props.schedule,
    disabled: () => !!props.disabled,
    onChange: props.onChange,
    onEditingChange: props.onEditingChange,
  });
  let viewport!: HTMLDivElement;
  let weeklySection!: HTMLElement;
  let exceptionsSection!: HTMLElement;
  let anchor: HTMLElement | undefined;
  let anchorDate: string | undefined;
  let addExceptionButton!: HTMLButtonElement;
  let cancelCalendarDrag = () => {};
  const locked = () => !!props.disabled || editor.hasChanges();
  const weeklyDraft = () => {
    const draft = editor.draft();
    return draft?.kind === 'weekly' ? draft : undefined;
  };
  const dateDraft = () => {
    const draft = editor.draft();
    return draft?.kind === 'dates' ? draft : undefined;
  };
  const focusEditor = (section: HTMLElement) =>
    queueMicrotask(() => {
      const content = section.querySelector('[data-rule-editor]');
      const control =
        content?.querySelector<HTMLElement>(
          'input:not(:disabled):not([type="hidden"]):not([aria-hidden="true"]):not([tabindex="-1"])'
        ) ?? content?.querySelector<HTMLElement>('button:not(:disabled)');
      control?.focus({ preventScroll: true });
      content?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  const restoreFocus = () =>
    queueMicrotask(() => {
      const savedRow = Array.from(
        exceptionsSection.querySelectorAll<HTMLElement>('[data-exception-date]')
      ).find((row) => row.dataset.exceptionDate === anchorDate);
      const fallback =
        savedRow?.querySelector<HTMLButtonElement>('button') ??
        addExceptionButton;
      (anchor?.isConnected ? anchor : fallback).focus({ preventScroll: true });
    });
  const close = () => {
    const wasDateDraft = !!dateDraft();
    cancelCalendarDrag();
    editor.close();
    if (!wasDateDraft) restoreFocus();
  };
  const apply = () => {
    const wasDateDraft = !!dateDraft();
    if (editor.apply() && !wasDateDraft) restoreFocus();
  };
  const openWeekday = (day: number, source: HTMLElement) => {
    if (locked()) return;
    anchor = source;
    editor.openWeekday(day);
    focusEditor(weeklySection);
  };
  const openDates = (dates: string[], source: HTMLElement) => {
    if (locked()) return;
    const calendarAnchor = source.closest<HTMLElement>(
      '[data-availability-date]'
    );
    anchor = calendarAnchor ?? source;
    anchorDate = dates[0];
    editor.openDates(dates);
    if (!calendarAnchor && dates.length === 1) setMonthDate(dates[0]);
  };
  const hoursFor = (
    target: { kind: 'weekly'; day: number } | { kind: 'date'; date: string }
  ) => availabilityRuleHours(props.schedule, target);
  const columns = (): AvailabilityColumn[] =>
    availabilityMonth(monthDate()).map((date) => {
      const overridden = props.schedule.overrides.some(
        (entry) => entry.date === date
      );
      const hours = hoursFor({ kind: 'date', date });
      return {
        target: { kind: 'date', date },
        overridden,
        windows: hours.windows,
        unavailable: hours.unavailableWindows,
      };
    });
  const changeMonth = (date: string) => {
    if (locked()) return;
    cancelCalendarDrag();
    editor.close();
    setMonthDate(date);
  };

  return (
    <div
      ref={viewport}
      class="portal-scope @container/availability flex min-h-0 min-w-0 flex-1 flex-col gap-8 overflow-y-auto pt-6 pb-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !editor.draft())
          return;
        if (
          event.target instanceof Element &&
          event.target.closest(
            '[role="dialog"], [aria-haspopup="dialog"][aria-expanded="true"]'
          )
        )
          return;
        event.preventDefault();
        close();
      }}
    >
      <header
        aria-label="Schedule details"
        class="flex shrink-0 flex-col gap-5"
      >
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-4">
          <div class="min-w-0 flex-1 pr-1">
            <AvailabilityScheduleTitle
              name={props.schedule.name}
              disabled={!!props.disabled}
              onChange={(name) =>
                props.onChange((schedule) => ({ ...schedule, name }))
              }
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-failure not-touch:not-disabled:hover:text-failure"
            tooltip="Clear weekly hours and date exceptions from this draft. Save to apply."
            disabled={!!props.disabled}
            onClick={() => {
              cancelCalendarDrag();
              editor.clearAll();
            }}
          >
            <Trash class="size-4" />
            Clear schedule
          </Button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div class="min-w-0 max-w-full">
            <AvailabilityFieldRow icon={<Globe />} align="center">
              <div class="flex min-w-0 flex-wrap items-center gap-3 text-sm">
                <span class="text-ink-muted">Time zone</span>
                <div class="min-w-0 w-64 max-w-full">
                  <TimeZoneInput
                    value={props.schedule.timeZone}
                    disabled={!!props.disabled || !!editor.draft()}
                    onChange={(timeZone) =>
                      props.onChange((schedule) => ({ ...schedule, timeZone }))
                    }
                  />
                </div>
              </div>
            </AvailabilityFieldRow>
          </div>
          <Tabs
            aria-label="Time format"
            list={[
              { value: '12h', label: '12h' },
              { value: '24h', label: '24h' },
            ]}
            value={timeFormat()}
            onChange={(value) => {
              if (value === '12h' || value === '24h') setTimeFormat(value);
            }}
          />
        </div>
      </header>

      <div class="grid min-w-0 shrink-0 grid-cols-1 items-start gap-10 @min-[1050px]/availability:grid-cols-[minmax(0,1fr)_minmax(28rem,1fr)]">
        <section ref={weeklySection} aria-label="Weekly hours" class="min-w-0">
          <div class="mb-5 flex items-start gap-3">
            <ArrowsClockwise class="mt-0.5 size-5 shrink-0 text-ink-muted" />
            <div>
              <h3 class="text-base font-semibold">Weekly hours</h3>
              <p class="mt-1 text-xs leading-relaxed text-ink-muted">
                Your regular hours, repeated every week.
              </p>
            </div>
          </div>
          <div class="divide-y divide-edge-muted">
            <For each={WEEKDAYS}>
              {(day, index) => {
                const target = { kind: 'weekly' as const, day: index() };
                const active = () => weeklyDraft()?.day === index();
                const hours = () => hoursFor(target);
                return (
                  <div class="py-4 first:pt-0" data-weekday={index()}>
                    <div class="flex items-start gap-3">
                      <h4 class="w-24 shrink-0 pt-1 text-sm font-medium">
                        {day}
                      </h4>
                      <div class="min-w-0 flex-1 pt-1">
                        <AvailabilityHoursSummary
                          hours={hours()}
                          timeFormat={timeFormat()}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        label={`${hours().windows.length || hours().unavailableWindows.length ? 'Edit' : 'Add'} ${day} hours`}
                        aria-expanded={active()}
                        disabled={locked()}
                        onClick={(event) =>
                          openWeekday(index(), event.currentTarget)
                        }
                      >
                        <Show
                          when={
                            hours().windows.length ||
                            hours().unavailableWindows.length
                          }
                          fallback={<Plus class="size-4" />}
                        >
                          <Pencil class="size-4" />
                        </Show>
                      </Button>
                    </div>
                    <Show when={active() ? weeklyDraft() : undefined}>
                      {(draft) => (
                        <div
                          data-rule-editor
                          class="mt-4 rounded-xl border border-edge-muted bg-surface-1 p-4"
                        >
                          <AvailabilityHoursEditor
                            ranges={draft().ranges}
                            scope="weekly"
                            issue={editor.issue()}
                            disabled={!!props.disabled}
                            onChange={editor.update}
                          >
                            <p class="shrink-0 text-xs leading-relaxed text-ink-muted">
                              Repeats every week. Date exceptions stay
                              unchanged.
                            </p>
                            <div class="flex shrink-0 flex-wrap justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={close}>
                                Cancel
                              </Button>
                              <Button
                                variant="cta"
                                size="sm"
                                disabled={!draft().ranges}
                                onClick={apply}
                              >
                                Apply weekly hours
                              </Button>
                            </div>
                          </AvailabilityHoursEditor>
                        </div>
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <p class="mt-4 text-xs leading-relaxed text-ink-extra-muted">
            Not set is blank and non-bookable. Add unavailable hours to mark
            explicit time off.
          </p>
        </section>

        <div class="flex min-w-0 flex-col gap-8">
          <section aria-label="Calendar preview" class="min-w-0">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <CalendarBlank class="size-5 text-ink-muted" />
                <h3 class="text-base font-semibold">Calendar preview</h3>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  label="Previous month"
                  disabled={locked()}
                  onClick={() =>
                    changeMonth(shiftAvailabilityMonth(monthDate(), -1))
                  }
                >
                  <ArrowLeft class="size-4" />
                </Button>
                <AvailabilityMonthPicker
                  date={monthDate()}
                  disabled={locked()}
                  onChange={changeMonth}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  label="Next month"
                  disabled={locked()}
                  onClick={() =>
                    changeMonth(shiftAvailabilityMonth(monthDate(), 1))
                  }
                >
                  <ArrowRight class="size-4" />
                </Button>
              </div>
            </div>
            <div
              class="overflow-hidden rounded-xl border border-edge-muted"
              data-availability-calendar-frame
            >
              <AvailabilityCalendar
                columns={columns()}
                month={monthDate().slice(0, 7)}
                today={reportDate(new Date(), props.schedule.timeZone)}
                timeFormat={timeFormat()}
                disabled={locked()}
                selectedDates={dateDraft()?.dates ?? []}
                selectedWeekday={weeklyDraft()?.day}
                weekdayStates={WEEKDAYS.map((_, day) =>
                  availabilityState(props.schedule, { kind: 'weekly', day })
                )}
                getBoundary={() => viewport}
                onCancelReady={(cancel) => {
                  cancelCalendarDrag = cancel;
                }}
                onCancelSelection={close}
                onDates={(dates, source) => openDates(dates, source)}
                onSelect={(date, source) => openDates([date], source)}
                onSelectWeekday={openWeekday}
              />
            </div>
            <p class="mt-3 text-xs leading-relaxed text-ink-muted">
              Select dates to add an exception. Select a weekday heading to edit
              recurring hours.
            </p>
          </section>

          <section
            ref={exceptionsSection}
            aria-label="Date exceptions"
            class="min-w-0 border-t border-edge-muted pt-6"
          >
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold">Date exceptions</h3>
                <p class="mt-1 text-xs leading-relaxed text-ink-muted">
                  Different hours or time off on specific dates.
                </p>
              </div>
              <Button
                ref={addExceptionButton}
                variant="outline"
                size="sm"
                disabled={locked()}
                onClick={(event) =>
                  openDates([monthDate()], event.currentTarget)
                }
              >
                <Plus class="size-4" />
                Add exception
              </Button>
            </div>
            <div class="divide-y divide-edge-muted">
              <For
                each={[...props.schedule.overrides].sort((a, b) =>
                  a.date.localeCompare(b.date)
                )}
                fallback={
                  <p class="py-3 text-sm text-ink-extra-muted">
                    No exceptions. Every date follows your weekly hours.
                  </p>
                }
              >
                {(override) => (
                  <div
                    data-exception-date={override.date}
                    class="flex items-start gap-3 py-4"
                  >
                    <div class="flex min-w-0 flex-1 flex-col gap-2">
                      <h4 class="text-sm font-medium">
                        {formatAvailabilityDate(override.date)}
                      </h4>
                      <AvailabilityHoursSummary
                        hours={hoursFor({ kind: 'date', date: override.date })}
                        timeFormat={timeFormat()}
                      />
                      <Show
                        when={
                          !override.windows.length &&
                          override.unavailableWindows?.length === 0
                        }
                      >
                        <span class="text-xs text-ink-muted">
                          Weekly hours do not apply.
                        </span>
                      </Show>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      label={`Edit exception ${formatAvailabilityDate(override.date)}`}
                      disabled={locked()}
                      onClick={(event) =>
                        openDates([override.date], event.currentTarget)
                      }
                    >
                      <Pencil class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      label={`Remove exception ${formatAvailabilityDate(override.date)}`}
                      tooltip="Remove this exception and use weekly hours again"
                      disabled={locked()}
                      onClick={() => {
                        editor.removeOverride(override.date);
                        queueMicrotask(() =>
                          addExceptionButton.focus({ preventScroll: true })
                        );
                      }}
                    >
                      <Trash class="size-4" />
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </section>
        </div>
      </div>
      <AvailabilityExceptionDialog
        open={!!dateDraft()}
        dates={dateDraft()?.dates ?? []}
        ranges={dateDraft()?.ranges}
        issue={editor.issue()}
        disabled={!!props.disabled}
        locked={locked()}
        onSelectDate={(date) => {
          if (!validAvailabilityDate(date)) return;
          editor.openDates([date]);
          setMonthDate(date);
        }}
        onChange={editor.update}
        onApply={apply}
        onCancel={close}
        onClear={() => editor.clearHours()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      />
      <Show when={editor.notice()}>
        <p role="status" class="shrink-0 text-xs text-ink-muted">
          {editor.notice()}
        </p>
      </Show>
    </div>
  );
}
