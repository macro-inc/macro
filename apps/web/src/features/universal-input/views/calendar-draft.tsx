import { DateTimeRangeFields } from '@app/components/date-time-range/date-time-range-fields';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { format, isValid, parseISO } from 'date-fns';
import {
  createEffect,
  createMemo,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import {
  EventComposerCalendarPill,
  EventComposerGuestsPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
} from '../../calendar/components/composer/EventPropertyPills';
import { EventTitleInput } from '../../calendar/components/composer/EventTitleInput';
import {
  createEventEditorState,
  type EventEditorInitialValues,
  guestEmail,
} from '../../calendar/components/composer/event-form-model';
import { RecurrenceBuilder } from '../../calendar/components/composer/RecurrenceBuilder';
import { buildRecurrenceLines } from '../../calendar/utils/recurrence';
import type { InputDisplay } from '../context/capabilities';
import { parseRecurrenceDraft } from '../core/recurrence';
import type { UniversalInputController } from '../primitives/universal-input';
import {
  composerRecipientOptions,
  composerRecipients,
} from '../queries/composer-recipients';

/** Reuse the calendar composer's date/time menus and editable property pills. */
export function CalendarDraft(props: {
  state: UniversalInputController;
  actions: InputDisplay;
}) {
  const s = props.state;
  const a = props.actions;
  const hintId = createUniqueId();
  onCleanup(() => a.captureCalendarEditor?.(undefined));
  const calendars = createMemo(() =>
    a.calendars().map((calendar) => ({
      id: calendar.id,
      label: `${calendar.name} · ${calendar.emailAddress}`,
      color: 'var(--color-accent)',
    }))
  );
  const guests = createMemo(() =>
    composerRecipients(s.fields().guests, a.people())
  );
  const options = createMemo(() =>
    composerRecipientOptions(a.people()).filter(
      (person) => person.kind !== 'custom'
    )
  );
  const recurrenceValues = (): EventEditorInitialValues => {
    const fields = s.fields();
    const config = parseRecurrenceDraft(fields.recurrence);
    return {
      title: fields.title,
      description: fields.body,
      allDay: false,
      start: fields.start,
      end: fields.end,
      guests: fields.guests,
      location: fields.location,
      conference: 'none',
      recurrenceLines: config
        ? buildRecurrenceLines(
            config,
            false,
            Intl.DateTimeFormat().resolvedOptions().timeZone
          )
        : [],
    };
  };
  const repetition = createEventEditorState({
    initialValues: recurrenceValues(),
    state: recurrenceValues,
    recurrenceTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  createEffect(
    on(
      [() => s.fields().recurrence, () => s.fields().start.slice(0, 10)],
      ([, day], previous) => {
        // Reclassify a fixed manual rule against the new start day so the pill
        // cannot describe a recomputed preset while submission retains the old rule.
        if (
          day !== previous?.[1] ||
          !s.draft().edited.calendar.includes('recurrence')
        )
          repetition.replaceInitialValues(recurrenceValues());
      }
    )
  );
  const saveRepetition = () => {
    const config = repetition.recurrenceConfig();
    const value = config ? JSON.stringify(config) : '';
    if (value !== s.fields().recurrence) s.edit('recurrence', value);
  };
  const assumption = () => {
    const phrase = s.fields().start_assumption;
    if (s.draft().edited.calendar.includes('start') || !phrase) return;
    const start = parseISO(s.fields().start);
    if (!isValid(start)) return;
    return `Assumed ${format(start, 'h:mm a')} for “${phrase}”. Adjust the start time if you meant otherwise.`;
  };
  const changeStart = (start: string) => {
    const duration =
      new Date(s.fields().end).getTime() - new Date(s.fields().start).getTime();
    s.edit('start', start);
    if (duration > 0 && Number.isFinite(new Date(start).getTime())) {
      const end = new Date(new Date(start).getTime() + duration);
      const local = new Date(end.getTime() - end.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      s.edit('end', local);
    }
  };
  return (
    <div class="space-y-4">
      <DateTimeRangeFields
        subject="event"
        start={s.fields().start}
        end={s.fields().end}
        allDay={false}
        onStartChange={changeStart}
        onEndChange={(end) => s.edit('end', end)}
        startDisabled={s.sending()}
        endDisabled={s.sending()}
        describedBy={assumption() ? hintId : undefined}
      />
      <Show when={assumption()}>
        {(hint) => (
          <p
            id={hintId}
            role="note"
            class="rounded-md bg-accent/8 px-2.5 py-2 text-xs text-ink"
          >
            {hint()}
          </p>
        )}
      </Show>
      <p class="text-xs text-ink-muted" aria-label="Time zone">
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </p>
      <EventTitleInput
        value={s.fields().title}
        onChange={(title) => s.edit('title', title)}
        disabled={s.sending()}
      />
      <MarkdownTextarea
        type="calendar"
        value={s.fields().body}
        editable={() => !s.sending()}
        onChange={(value) => {
          if (value !== s.fields().body) s.edit('body', value);
        }}
        captureEditor={(editor) => a.captureCalendarEditor?.(editor)}
        resolveAppLink={a.resolveAppLink}
        placeholder="Add description..."
        portalScope="local"
        floatingFormatMenu
        domRef={(element) => element.setAttribute('aria-label', 'Description')}
        class="h-auto min-h-12 [&>[contenteditable]]:min-h-12"
      />
      <div class="flex flex-wrap items-center gap-2">
        <EventComposerCalendarPill
          options={calendars()}
          value={calendars().find(
            (calendar) => calendar.id === a.selectedCalendar(s.fields())?.id
          )}
          onChange={(id) => s.edit('calendarId', id)}
          disabled={s.sending()}
        />
        <EventComposerRecurrencePill
          options={repetition.recurrenceOptions()}
          value={repetition.selectedRecurrenceOption()}
          onChange={(value) => {
            if (value === repetition.recurrenceChoice()) return;
            repetition.changeRecurrenceChoice(value);
            saveRepetition();
          }}
          disabled={s.sending()}
        />
        <EventComposerGuestsPill
          options={options}
          selected={guests()}
          onChange={(selected) =>
            s.edit('guests', selected.map(guestEmail).join(', '))
          }
          disabled={s.sending()}
        />
        <EventComposerLocationPill
          value={s.fields().location}
          onChange={(value) => s.edit('location', value)}
          disabled={s.sending()}
        />
      </div>
      <Show when={repetition.recurrenceChoice() === 'custom'}>
        <RecurrenceBuilder
          value={repetition.customConfig()}
          start={repetition.startForRecurrence()}
          allDay={false}
          disabled={s.sending()}
          onChange={(value) => {
            repetition.setCustomConfig(value);
            saveRepetition();
          }}
        />
      </Show>
    </div>
  );
}
