import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { ToggleSwitch } from '@ui';
import { createEffect, createMemo, For, Show } from 'solid-js';
import {
  type DayQuietHours,
  type DayQuietMode,
  deviceTimeZone,
  type QuietHours,
  WEEKDAY_NAMES,
  WEEKDAYS,
  type Weekday,
} from '../core/quiet-hours';

function formatClock(minutes: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

function windowPhrase(startMinutes: number, endMinutes: number): string {
  if (startMinutes === endMinutes) {
    return 'Start and end match, so nothing is silenced.';
  }
  const start = formatClock(startMinutes);
  const end = formatClock(endMinutes);
  if (startMinutes > endMinutes) {
    return `From ${start} to ${end}, including overnight.`;
  }
  return `From ${start} to ${end}.`;
}

function scheduleSummary(quiet: QuietHours): string {
  const active = WEEKDAYS.filter((day) => quiet.days[day].mode !== 'off');
  if (active.length === 0) return 'Every day is off, so nothing is silenced.';
  const first = quiet.days[active[0]];
  const sharedHours = active.every((day) => {
    const current = quiet.days[day];
    return (
      current.mode === 'hours' &&
      current.startMinutes === first.startMinutes &&
      current.endMinutes === first.endMinutes
    );
  });
  if (sharedHours && active.length === WEEKDAYS.length) {
    return windowPhrase(first.startMinutes, first.endMinutes);
  }
  return 'Each day has its own hours.';
}

/** Quarter hours, plus a saved time that is not on that grid. */
function timeChoices(selected: number): { id: string; name: string }[] {
  const minutes = Array.from({ length: 96 }, (_, index) => index * 15);
  if (!minutes.includes(selected)) minutes.push(selected);
  minutes.sort((left, right) => left - right);
  return minutes.map((value) => ({
    id: String(value),
    name: formatClock(value),
  }));
}

function timeZoneChoices(selected: string): { id: string; name: string }[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [deviceTimeZone()];
  }
  if (selected && !zones.includes(selected)) zones = [selected, ...zones];
  return zones.map((id) => ({ id, name: id.replaceAll('_', ' ') }));
}

const DAY_MODES: { id: DayQuietMode; name: string }[] = [
  { id: 'hours', name: 'Hours' },
  { id: 'all-day', name: 'All day' },
  { id: 'off', name: 'Off' },
];

/**
 * Native selects reset to the first option when their options render after
 * the value, so the chosen value is applied again once the options exist.
 */
function SettingsSelect(props: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  class: string;
  onChange: (value: string) => void;
}) {
  let select: HTMLSelectElement | undefined;
  createEffect(() => {
    const value = props.value;
    props.options;
    if (select) select.value = value;
  });

  return (
    <select
      ref={select}
      aria-label={props.label}
      class={props.class}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <For each={props.options}>
        {(option) => <option value={option.id}>{option.name}</option>}
      </For>
    </select>
  );
}

function DayQuietHoursRow(props: {
  day: Weekday;
  schedule: DayQuietHours;
  onChange: (change: Partial<DayQuietHours>) => void;
}) {
  const name = () => WEEKDAY_NAMES[props.day];
  const startTimes = createMemo(() => timeChoices(props.schedule.startMinutes));
  const endTimes = createMemo(() => timeChoices(props.schedule.endMinutes));

  const setMode = (mode: string) => {
    if (mode !== 'off' && mode !== 'hours' && mode !== 'all-day') return;
    props.onChange({ mode });
  };

  const setMinutes = (field: 'startMinutes' | 'endMinutes', raw: string) => {
    const minutes = Number(raw);
    if (!Number.isInteger(minutes)) return;
    props.onChange({ [field]: minutes });
  };

  return (
    <SettingsRow
      stackOnNarrow
      label={name()}
      muted={props.schedule.mode === 'off'}
    >
      <div class="flex max-w-full flex-wrap items-center gap-2">
        <select
          aria-label={`${name()} quiet hours`}
          class="settings-input w-28"
          value={props.schedule.mode}
          onChange={(event) => setMode(event.currentTarget.value)}
        >
          <For each={DAY_MODES}>
            {(mode) => <option value={mode.id}>{mode.name}</option>}
          </For>
        </select>
        <Show when={props.schedule.mode === 'hours'}>
          <div class="flex items-center gap-2">
            <SettingsSelect
              label={`${name()} start`}
              class="settings-input w-32"
              value={String(props.schedule.startMinutes)}
              options={startTimes()}
              onChange={(value) => setMinutes('startMinutes', value)}
            />
            <span class="text-sm text-ink/60" aria-hidden="true">
              to
            </span>
            <SettingsSelect
              label={`${name()} end`}
              class="settings-input w-32"
              value={String(props.schedule.endMinutes)}
              options={endTimes()}
              onChange={(value) => setMinutes('endMinutes', value)}
            />
          </div>
        </Show>
      </div>
    </SettingsRow>
  );
}

/** Weekly schedule that silences sounds and desktop notifications. */
export function QuietHoursSection(props: {
  quietHours: QuietHours;
  onChange: (change: Partial<QuietHours>) => void;
}) {
  const zones = createMemo(() => timeZoneChoices(props.quietHours.timeZone));
  const summary = () =>
    props.quietHours.enabled
      ? scheduleSummary(props.quietHours)
      : 'Off until you turn them on.';

  const setEnabled = (enabled: boolean) => {
    if (enabled && !props.quietHours.timeZone) {
      props.onChange({ enabled, timeZone: deviceTimeZone() });
      return;
    }
    props.onChange({ enabled });
  };

  const setDay = (day: Weekday, change: Partial<DayQuietHours>) => {
    props.onChange({
      days: {
        ...props.quietHours.days,
        [day]: { ...props.quietHours.days[day], ...change },
      },
    });
  };

  return (
    <SettingsSection
      title="Quiet hours"
      description="Silence notification sounds and desktop notifications during these hours. Each day has its own hours, and a day can be off or quiet all day. Inbox items still arrive, and incoming calls still ring. Saved on this device."
    >
      <SettingsCard>
        <SettingsRow label="Quiet hours" description={summary()}>
          <ToggleSwitch
            size="md"
            label="Quiet hours"
            labelClass="sr-only"
            checked={props.quietHours.enabled}
            onChange={setEnabled}
          />
        </SettingsRow>
        <Show when={props.quietHours.enabled}>
          <For each={WEEKDAYS}>
            {(day) => (
              <DayQuietHoursRow
                day={day}
                schedule={props.quietHours.days[day]}
                onChange={(change) => setDay(day, change)}
              />
            )}
          </For>
          <SettingsRow stackOnNarrow label="Time zone">
            {/* Native menu: the zone list is hundreds of rows. */}
            <SettingsSelect
              label="Time zone"
              class="settings-input min-w-0 w-full @[460px]:w-72"
              value={props.quietHours.timeZone || deviceTimeZone()}
              options={zones()}
              onChange={(timeZone) => props.onChange({ timeZone })}
            />
          </SettingsRow>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}
