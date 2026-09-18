import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { CalendarUpdateScope } from '@service-email/client';
import { Button, cn, Layer, RadioGroup, ToggleSwitch } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  Show,
} from 'solid-js';
import {
  calendarDescriptionToEditorHtml,
  exportCalendarDescription,
} from '../../utils/calendar-description';
import type { CalendarEventFormController } from './create-calendar-event-form-controller';
import { EventDateTimeRangeFields } from './EventDateTimeRangeFields';
import {
  EventComposerCalendarPill,
  EventComposerConferencePill,
  EventComposerDeclineMessagePill,
  EventComposerDeclinePill,
  EventComposerGuestsPill,
  EventComposerKindPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
  EventComposerRemindersPill,
} from './EventPropertyPills';
import type {
  EventEditorConferenceChoice,
  EventEditorDisabledFields,
  EventEditorSubmitValues,
} from './event-form-model';
import { outOfOfficeNoticeFor } from './out-of-office';
import { RecurrenceBuilder } from './RecurrenceBuilder';

export interface EventFormProps {
  controller: CalendarEventFormController;
  isEdit?: boolean;
  /** The host can create persistent Macro meeting links on save. */
  allowMacroCall?: boolean;
  /** Existing Macro call URL shown when editing a saved event. */
  macroCallUrl?: string;
  saveError?: string;
  disabledFields?: EventEditorDisabledFields;
  showRecurringEditNotice?: boolean;
  /** Disable interaction without presenting the form as an in-flight save. */
  disabled?: boolean;
  pending: boolean;
  class?: string;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (
    values: EventEditorSubmitValues,
    scope?: CalendarUpdateScope
  ) => void;
}

/** Whether edits to a recurring event patch one occurrence or the whole series. */
const RECURRING_EDIT_SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarUpdateScope;
  label: string;
}[];

/** Create/edit event form laid out like the standalone task composer. */
export function EventForm(props: EventFormProps) {
  const formId = createUniqueId();

  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;
  const pastEventWarningId = `event-composer-past-event-warning-${formId}`;

  const controller = props.controller;
  const state = controller.state;
  const isEdit = () => props.isEdit ?? false;
  const formIsDisabled = () => props.pending || props.disabled === true;

  // Recurring edits default to the whole series, matching the long-standing
  // behavior; "this event" writes a single-occurrence exception.
  const [editScope, setEditScope] = createSignal<CalendarUpdateScope>('all');

  // An invalid range already speaks for itself; only one line shows at a time.
  const pastEventWarning = () =>
    controller.dateRangeError() ? undefined : controller.pastEventWarning();
  const dateRangeDescribedBy = () => {
    if (controller.dateRangeError()) return dateRangeErrorId;
    return pastEventWarning() ? pastEventWarningId : undefined;
  };

  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    props.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    formIsDisabled() || fieldIsReadOnly(field);

  const isOutOfOffice = () => controller.isOutOfOffice();
  let previousConference: EventEditorConferenceChoice =
    state().conference === 'macro_call' ? 'none' : state().conference;
  const toggleMacroCall = (checked: boolean) => {
    if (checked) {
      previousConference = state().conference;
      controller.setField('conference', 'macro_call');
    } else {
      controller.setField('conference', previousConference);
    }
  };
  // The decline settings of an edited event are unknown until picked, and the
  // disclosure must not claim behavior nobody chose.
  const outOfOfficeNotice = () => {
    const outOfOffice = state().outOfOffice;
    if (!isOutOfOffice() || !outOfOffice) return undefined;
    return outOfOfficeNoticeFor(
      outOfOffice.autoDeclineMode,
      outOfOffice.declineMessage
    );
  };

  // The editor cannot hand the provider's string back: Lexical re-serializes
  // whatever it loads. Only content that exports differently from what was
  // loaded counts as an edit, so an untouched description stays byte-for-byte
  // what the event was opened with.
  const initialDescription = state().description;
  let loadedDescription: string | undefined;

  createEffect(() => {
    const option = controller.selectedCalendarOption();
    if (option) props.onCalendarChange?.(option.id, option.color);
  });
  createEffect(() => props.onDirtyChange?.(controller.isDirty()));

  const submit = () => {
    const values = controller.submitValues();
    if (!values || formIsDisabled()) return;
    props.onSubmit(
      values,
      props.showRecurringEditNotice ? editScope() : undefined
    );
  };

  return (
    <form
      class={cn(
        'flex min-h-0 flex-1 flex-col gap-4 text-sm text-ink-muted [&_:disabled]:cursor-not-allowed',
        props.class
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scrollbar-hidden">
        <div class="flex min-w-0 flex-col gap-6 text-sm text-ink-muted">
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex min-w-0 flex-col gap-1">
              <EventDateTimeRangeFields
                start={state().start}
                end={state().end}
                allDay={state().allDay}
                onStartChange={controller.setStart}
                onEndChange={(end) => controller.setField('end', end)}
                startDisabled={fieldIsDisabled('start')}
                endDisabled={fieldIsDisabled('end')}
                invalid={controller.dateRangeError() !== undefined}
                describedBy={dateRangeDescribedBy()}
              />
              <Show when={controller.dateRangeError()}>
                {(error) => (
                  <p
                    id={dateRangeErrorId}
                    role="alert"
                    class="text-xs text-failure"
                  >
                    {error()}
                  </p>
                )}
              </Show>
              <Show when={pastEventWarning()}>
                {(warning) => (
                  <p
                    id={pastEventWarningId}
                    role="status"
                    class="text-xs text-warning"
                  >
                    {warning()}
                  </p>
                )}
              </Show>
            </div>

            <input
              type="text"
              value={state().title}
              onInput={(event) =>
                controller.setField('title', event.currentTarget.value)
              }
              placeholder="New event"
              aria-label="Title"
              autofocus={!isEdit()}
              disabled={fieldIsDisabled('title')}
              class="h-9 w-full bg-transparent px-2 text-lg font-semibold leading-snug text-ink outline-none placeholder:text-ink-placeholder"
            />

            <Show when={!isOutOfOffice()}>
              <div class="h-12 overflow-y-auto">
                <MarkdownTextarea
                  type="calendar"
                  initialHtml={calendarDescriptionToEditorHtml(
                    initialDescription
                  )}
                  editable={() => !fieldIsDisabled('description')}
                  onInitialized={(editor) => {
                    loadedDescription = exportCalendarDescription(editor);
                  }}
                  onChange={(_markdown, editor) => {
                    if (!editor) return;
                    const next = exportCalendarDescription(editor);
                    controller.setField(
                      'description',
                      next === loadedDescription ? initialDescription : next
                    );
                  }}
                  placeholder="Add description..."
                  portalScope="local"
                  domRef={(element) =>
                    element.setAttribute('aria-label', 'Description')
                  }
                  class="h-full w-full bg-transparent px-2 text-sm text-ink outline-none"
                />
              </div>
            </Show>
          </div>

          <div class="flex flex-col gap-3 px-2">
            <div class="flex flex-wrap items-center gap-6">
              <ToggleSwitch
                checked={state().allDay}
                disabled={fieldIsDisabled('allDay')}
                onChange={controller.setAllDay}
                size="sm"
                label="All day"
                labelClass="whitespace-nowrap text-xs text-ink-muted"
              />
              <Show
                when={
                  !isOutOfOffice() &&
                  (props.allowMacroCall || state().conference === 'macro_call')
                }
              >
                <ToggleSwitch
                  checked={state().conference === 'macro_call'}
                  disabled={fieldIsDisabled('conference')}
                  onChange={toggleMacroCall}
                  size="sm"
                  label="Macro call"
                  labelClass="whitespace-nowrap text-xs text-ink-muted"
                />
              </Show>
            </div>
            <Show
              when={!isOutOfOffice() && state().conference === 'macro_call'}
            >
              <Show
                when={props.macroCallUrl}
                fallback={
                  <span class="text-xs text-ink-extra-muted">
                    Call link created when event is saved
                  </span>
                }
              >
                {(url) => (
                  <a
                    href={url()}
                    target="_blank"
                    rel="noreferrer"
                    class="break-all text-xs text-accent underline"
                    aria-label="Join Macro call"
                  >
                    {url()}
                  </a>
                )}
              </Show>
            </Show>
          </div>

          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <EventComposerKindPill
              eventType={state().eventType}
              onChange={controller.setEventKind}
              disabled={formIsDisabled()}
              readOnly={isEdit()}
            />
            <EventComposerCalendarPill
              options={controller.calendarOptions()}
              value={controller.selectedCalendarOption()}
              onChange={(calendarId) =>
                controller.setField('calendarId', calendarId)
              }
              disabled={formIsDisabled()}
              readOnly={fieldIsReadOnly('calendar')}
            />
            <EventComposerRecurrencePill
              options={controller.recurrenceOptions()}
              value={controller.selectedRecurrenceOption()}
              onChange={controller.changeRecurrenceChoice}
              disabled={formIsDisabled()}
              readOnly={
                fieldIsReadOnly('recurrence') || editScope() === 'this_event'
              }
            />
            <Show when={!isOutOfOffice()}>
              <EventComposerGuestsPill
                options={controller.guestOptions}
                selected={controller.selectedGuests()}
                onChange={controller.setSelectedGuests}
                disabled={formIsDisabled()}
                readOnly={fieldIsReadOnly('guests')}
              />
              <Show when={state().conference !== 'macro_call'}>
                <EventComposerConferencePill
                  value={state().conference}
                  canKeepExisting={
                    controller.initialConferenceChoice() === 'existing'
                  }
                  onChange={(conference) =>
                    controller.setField('conference', conference)
                  }
                  disabled={fieldIsDisabled('conference')}
                />
              </Show>
              <EventComposerLocationPill
                value={state().location}
                onChange={(location) =>
                  controller.setField('location', location)
                }
                disabled={fieldIsDisabled('location')}
              />
            </Show>
            <Show when={isOutOfOffice()}>
              <EventComposerDeclinePill
                value={state().outOfOffice}
                onChange={controller.setOutOfOffice}
                disabled={formIsDisabled()}
              />
              <Show
                when={
                  state().outOfOffice &&
                  state().outOfOffice?.autoDeclineMode !== 'decline_none'
                }
              >
                <EventComposerDeclineMessagePill
                  value={state().outOfOffice?.declineMessage ?? ''}
                  onChange={(declineMessage) =>
                    controller.setOutOfOffice({
                      autoDeclineMode:
                        state().outOfOffice?.autoDeclineMode ?? 'decline_none',
                      declineMessage,
                    })
                  }
                  disabled={formIsDisabled()}
                />
              </Show>
            </Show>
            <EventComposerRemindersPill
              minutes={controller.reminderMinutes()}
              usedSlots={
                controller.reminderMinutes().length +
                controller.preservedReminderCount()
              }
              canAdd={controller.canAddReminder()}
              onChange={controller.setReminderMinutes}
              disabled={fieldIsDisabled('reminders')}
            />
          </div>

          <Show when={outOfOfficeNotice()}>
            {(notice) => (
              <div
                role="note"
                aria-label="Out-of-office event"
                class="flex min-w-0 flex-col gap-1 rounded-lg border border-warning/40 bg-warning-bg p-3 text-xs text-warning-ink"
              >
                <span class="font-medium">Out-of-office event</span>
                <span>{notice().effect}</span>
                <Show when={notice().declineMessage}>
                  {(message) => (
                    <span class="italic">
                      Auto-decline reply: “{message()}”
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
        <Show when={controller.recurrenceChoice() === 'custom'}>
          <Layer depth={3}>
            <div class="rounded-xl bg-surface p-4 text-ink">
              <RecurrenceBuilder
                value={controller.customConfig()}
                start={controller.startForRecurrence()}
                allDay={state().allDay}
                disabled={
                  fieldIsDisabled('recurrence') || editScope() === 'this_event'
                }
                onChange={controller.setCustomConfig}
              />
            </div>
          </Layer>
        </Show>
      </div>

      <Show when={props.saveError}>
        {(error) => (
          <p role="alert" class="text-xs text-failure">
            {error()}
          </p>
        )}
      </Show>
      <div class="flex shrink-0 items-center justify-end gap-3">
        <Show when={props.showRecurringEditNotice}>
          <RadioGroup
            value={editScope()}
            onChange={(value) => setEditScope(value as CalendarUpdateScope)}
            disabled={formIsDisabled()}
            aria-label="Apply changes to"
            class="mr-auto flex-row items-center gap-3 text-xs text-ink-muted"
          >
            <For each={RECURRING_EDIT_SCOPE_OPTIONS}>
              {(option) => (
                <RadioGroup.Item value={option.scope} class="gap-1.5">
                  <RadioGroup.ItemControl class="size-3.5" />
                  <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="rounded-lg"
          disabled={formIsDisabled()}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={controller.canSave() ? 'accent' : 'ghost'}
          depth={3}
          class="rounded-lg border-0"
          disabled={!controller.canSave() || formIsDisabled()}
          aria-label={isEdit() ? 'Save' : 'Create event'}
        >
          <Show
            when={props.pending}
            fallback={isEdit() ? 'Save' : 'Create event'}
          >
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </form>
  );
}
