import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { Button, ToggleSwitch } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import {
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

function scheduleSummary(quiet: QuietHours): string {
  if (quiet.days.length === 0) return 'Pick at least one day.';
  if (quiet.startMinutes === quiet.endMinutes) {
    return 'Start and end match, so nothing is silenced.';
  }
  const start = formatClock(quiet.startMinutes);
  const end = formatClock(quiet.endMinutes);
  if (quiet.startMinutes > quiet.endMinutes) {
    return `From ${start} to ${end}, including overnight.`;
  }
  return `From ${start} to ${end}.`;
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

/** Weekly schedule that silences sounds and desktop notifications. */
export function QuietHoursSection(props: {
  quietHours: QuietHours;
  onChange: (change: Partial<QuietHours>) => void;
}) {
  const zones = createMemo(() => timeZoneChoices(props.quietHours.timeZone));
  const startTimes = createMemo(() =>
    timeChoices(props.quietHours.startMinutes)
  );
  const endTimes = createMemo(() => timeChoices(props.quietHours.endMinutes));
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

  const toggleDay = (day: Weekday) => {
    const selected = props.quietHours.days.includes(day)
      ? props.quietHours.days.filter((current) => current !== day)
      : [...props.quietHours.days, day];
    props.onChange({
      days: WEEKDAYS.filter((weekday) => selected.includes(weekday)),
    });
  };

  return (
    <SettingsSection
      title="Quiet hours"
      description="Silence notification sounds and desktop notifications during these hours. Inbox items still arrive, and incoming calls still ring. Saved on this device."
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
          <SettingsRow stackOnNarrow label="Days" align="start">
            <div
              role="group"
              aria-label="Days"
              class="flex max-w-full flex-wrap gap-1.5 @[460px]:justify-end"
            >
              <For each={WEEKDAYS}>
                {(day) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={WEEKDAY_NAMES[day]}
                    aria-pressed={props.quietHours.days.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {WEEKDAY_NAMES[day].slice(0, 3)}
                  </Button>
                )}
              </For>
            </div>
          </SettingsRow>
          <SettingsRow stackOnNarrow label="From">
            <select
              aria-label="Quiet hours start"
              class="settings-input w-36"
              value={String(props.quietHours.startMinutes)}
              onChange={(event) => {
                const minutes = Number(event.currentTarget.value);
                if (!Number.isInteger(minutes)) return;
                props.onChange({ startMinutes: minutes });
              }}
            >
              <For each={startTimes()}>
                {(option) => <option value={option.id}>{option.name}</option>}
              </For>
            </select>
          </SettingsRow>
          <SettingsRow stackOnNarrow label="Until">
            <select
              aria-label="Quiet hours end"
              class="settings-input w-36"
              value={String(props.quietHours.endMinutes)}
              onChange={(event) => {
                const minutes = Number(event.currentTarget.value);
                if (!Number.isInteger(minutes)) return;
                props.onChange({ endMinutes: minutes });
              }}
            >
              <For each={endTimes()}>
                {(option) => <option value={option.id}>{option.name}</option>}
              </For>
            </select>
          </SettingsRow>
          <SettingsRow stackOnNarrow label="Time zone">
            {/* Native menu: the zone list is hundreds of rows. */}
            <select
              aria-label="Time zone"
              class="settings-input min-w-0 w-full @[460px]:w-72"
              value={props.quietHours.timeZone || deviceTimeZone()}
              onChange={(event) =>
                props.onChange({ timeZone: event.currentTarget.value })
              }
            >
              <For each={zones()}>
                {(zone) => <option value={zone.id}>{zone.name}</option>}
              </For>
            </select>
          </SettingsRow>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}
