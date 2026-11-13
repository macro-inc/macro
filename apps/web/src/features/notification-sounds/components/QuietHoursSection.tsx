import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { formatLocale, t } from '@app/lib/i18n';
import { Button, ToggleSwitch } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import {
  deviceTimeZone,
  type QuietHours,
  WEEKDAYS,
  type Weekday,
} from '../core/quiet-hours';

function formatClock(minutes: number): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/** A weekday's name in the interface language; 2001 began on a Monday. */
function weekdayName(day: Weekday, width: 'long' | 'short'): string {
  return new Intl.DateTimeFormat(formatLocale(), { weekday: width }).format(
    new Date(2001, 0, 1 + WEEKDAYS.indexOf(day))
  );
}

function scheduleSummary(quiet: QuietHours): string {
  if (quiet.days.length === 0) return t('notificationSounds.quietNoDays');
  if (quiet.startMinutes === quiet.endMinutes) {
    return t('notificationSounds.quietSameTimes');
  }
  const start = formatClock(quiet.startMinutes);
  const end = formatClock(quiet.endMinutes);
  if (quiet.startMinutes > quiet.endMinutes) {
    return t('notificationSounds.quietOvernight', { start, end });
  }
  return t('notificationSounds.quietRange', { start, end });
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
      : t('notificationSounds.quietOff');

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
      title={t('notificationSounds.quietTitle')}
      target="Quiet hours"
      description={t('notificationSounds.quietDescription')}
    >
      <SettingsCard>
        <SettingsRow
          label={t('notificationSounds.quietTitle')}
          description={summary()}
        >
          <ToggleSwitch
            size="md"
            label={t('notificationSounds.quietTitle')}
            labelClass="sr-only"
            checked={props.quietHours.enabled}
            onChange={setEnabled}
          />
        </SettingsRow>
        <Show when={props.quietHours.enabled}>
          <SettingsRow
            stackOnNarrow
            label={t('notificationSounds.days')}
            align="start"
          >
            <div
              role="group"
              aria-label={t('notificationSounds.days')}
              class="flex max-w-full flex-wrap gap-1.5 @[460px]:justify-end"
            >
              <For each={WEEKDAYS}>
                {(day) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={weekdayName(day, 'long')}
                    aria-pressed={props.quietHours.days.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {weekdayName(day, 'short')}
                  </Button>
                )}
              </For>
            </div>
          </SettingsRow>
          <SettingsRow stackOnNarrow label={t('notificationSounds.from')}>
            <select
              aria-label={t('notificationSounds.quietStart')}
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
          <SettingsRow stackOnNarrow label={t('notificationSounds.until')}>
            <select
              aria-label={t('notificationSounds.quietEnd')}
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
          <SettingsRow stackOnNarrow label={t('notificationSounds.timeZone')}>
            {/* Native menu: the zone list is hundreds of rows. */}
            <select
              aria-label={t('notificationSounds.timeZone')}
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
