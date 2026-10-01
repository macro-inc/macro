import { getDefaultTimezone } from '@core/util/cron';
import { parseTime, useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { ActionDialogShell, Button, Input, SegmentedControl } from '@ui';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onMount,
  Show,
} from 'solid-js';
import {
  EventDateField,
  EventTimeInput,
} from '../../calendar/components/composer/EventDateTimeInputs';
import {
  formatReminderInstant,
  parseLocalReminderDateTime,
  REMINDER_DEFAULT_TIME,
  reminderQuickPresets,
} from '../reminder-schedule';

export type EmailReminderCondition = 'if_no_reply' | 'regardless';

/** Time-first, single-occurrence email form. The host owns persistence. */
export function EmailReminderForm(props: {
  subject: string;
  header?: JSX.Element;
  autofocus?: boolean;
  initialTime?: string;
  initialCondition?: EmailReminderCondition;
  pending: boolean;
  error?: string;
  onSave: (at: Date, condition: EmailReminderCondition) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  let whenInput: HTMLInputElement | undefined;
  // The server status may load after the dialog's initial autofocus pass.
  onMount(() => {
    if (props.autofocus) queueMicrotask(() => whenInput?.focus());
  });
  const now = new Date();
  const zone = getDefaultTimezone();
  const presets = reminderQuickPresets(now);
  const presetTime = (at: Date) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(at);
  const presetDay = (at: Date) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(at);
  const seed = props.initialTime
    ? new Date(props.initialTime)
    : presets[0].date;
  const [instant, setInstant] = createSignal<Date | undefined>(seed);
  const [query, setQuery] = createSignal('');
  const [custom, setCustom] = createSignal(false);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateValue = (at: Date) =>
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const timeValue = (at: Date) =>
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  const [date, setDate] = createSignal(dateValue(seed));
  const [time, setTime] = createSignal(timeValue(seed));
  const [condition, setCondition] = createSignal<EmailReminderCondition>(
    props.initialCondition ?? 'if_no_reply'
  );
  const id = createUniqueId();
  const options = useDateSearch({
    query,
    baseDate: now,
    defaultTime: REMINDER_DEFAULT_TIME,
  });
  const parsed = () => {
    const option = options()[0];
    const wallTime = parseTime(query())?.time;
    if (
      !option ||
      (wallTime &&
        (option.date.getHours() !== wallTime.hours ||
          option.date.getMinutes() !== wallTime.minutes))
    )
      return;
    return option.date;
  };
  const selected = () =>
    query().trim()
      ? parsed()
      : (instant() ?? parseLocalReminderDateTime(date(), time()));
  const valid = () => {
    const at = selected();
    return at !== undefined && at.getTime() > Date.now();
  };
  const choose = (at: Date) => {
    setInstant(at);
    setDate(dateValue(at));
    setTime(timeValue(at));
    setQuery('');
  };
  return (
    <>
      <ActionDialogShell.Body>
        {props.header}
        <p class="truncate text-sm text-ink-muted" title={props.subject}>
          {props.subject}
        </p>
        <form
          id={id}
          class="flex min-w-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const at = selected();
            if (!props.pending && valid() && at) props.onSave(at, condition());
          }}
        >
          <fieldset
            disabled={props.pending}
            class="flex min-w-0 flex-col gap-3"
          >
            <label
              for={`${id}-when`}
              class="text-xs font-medium text-ink-muted"
            >
              When
            </label>
            <Input
              ref={whenInput}
              id={`${id}-when`}
              size="lg"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Try “tomorrow 9am” or “in 30m”"
              autocomplete="off"
              aria-invalid={!valid()}
            />
            <Show when={!query().trim()}>
              <div class="grid min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-2">
                <For each={presets}>
                  {(preset) => (
                    <Button
                      type="button"
                      variant={
                        selected()?.getTime() === preset.date.getTime()
                          ? 'accent'
                          : 'outline'
                      }
                      class="h-auto min-h-11 min-w-0 justify-between gap-x-3 px-3 py-2 text-left whitespace-normal min-[480px]:flex-col min-[480px]:items-start"
                      onClick={() => choose(preset.date)}
                    >
                      <span class="text-xs">{preset.label}</span>
                      <span class="text-right text-xxs text-ink-muted min-[480px]:text-left">
                        {preset.id === 'next-week'
                          ? `${presetDay(preset.date)} · ${presetTime(preset.date)}`
                          : presetTime(preset.date)}
                      </span>
                    </Button>
                  )}
                </For>
              </div>
            </Show>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCustom(!custom())}
            >
              Choose date &amp; time
            </Button>
            <Show when={custom()}>
              <div class="grid min-w-0 gap-2 min-[360px]:grid-cols-2">
                <EventDateField
                  label="Reminder date"
                  value={date()}
                  portalScope="local"
                  onChange={(value) => {
                    setQuery('');
                    if (value !== date()) setInstant(undefined);
                    setDate(value);
                  }}
                />
                <EventTimeInput
                  id={`${id}-time`}
                  label="Time"
                  value={time()}
                  step={1}
                  onChange={(option) => {
                    setQuery('');
                    setInstant(undefined);
                    setTime(option.value);
                  }}
                  onClear={() => {
                    setQuery('');
                    setInstant(undefined);
                    setTime('');
                  }}
                />
              </div>
            </Show>
            <p class="text-xs text-ink-muted" role="status">
              {valid()
                ? formatReminderInstant(selected()!, zone, now)
                : 'Choose a future time. Times skipped by a clock change are unavailable.'}
            </p>
            <SegmentedControl<EmailReminderCondition>
              aria-label="Reminder condition"
              class="self-start"
              value={condition()}
              onChange={setCondition}
              options={[
                {
                  value: 'if_no_reply',
                  label: 'If no reply',
                  disabled: props.pending,
                },
                {
                  value: 'regardless',
                  label: 'Regardless',
                  disabled: props.pending,
                },
              ]}
            />
          </fieldset>
          <Show when={props.error}>
            <p role="alert" class="text-xs text-failure-ink">
              {props.error}
            </p>
          </Show>
        </form>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Show when={props.onRemove}>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={() => props.onRemove?.()}
          >
            Remove
          </Button>
        </Show>
        <Button
          type="button"
          variant="ghost"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form={id}
          variant="accent"
          disabled={props.pending || !valid()}
        >
          {props.pending
            ? 'Saving…'
            : props.initialTime
              ? 'Save changes'
              : 'Remind me'}
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
}
