import { ViewShell } from '@app/components/view-shell';
import { AVAILABILITY_TIME_BOUNDS } from '@app/features/calendar/availability/availability';
import { useAvailabilitySettings } from '@app/features/calendar/availability/settings';
import { createCalendarSettingsControls } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { TurnOffCalendarDialog } from '@app/features/calendar/components/TurnOffCalendarDialog';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useCalendarTeamSettings } from '@app/features/calendar-team/calendar-team';
import { usePending } from '@app/observability/flow';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useAndroidBackNavigation } from '@core/mobile/androidBack';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Plus from '@icon/system/regular/plus.svg';
import {
  useAvailabilityCalendarsQuery,
  useSetAvailabilityCalendarMutation,
} from '@queries/calendar/availability';
import { Button, Checkbox, Layer } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  CalendarSettingsGroup,
  CalendarSettingsRow,
  CalendarSettingsSelect,
  CalendarSettingsSwitch,
} from './calendar-settings-parts';

const SHARING_OPTIONS = [
  { id: 'busy_only', name: 'Busy blocks' },
  { id: 'all', name: 'Event details' },
  { id: 'none', name: 'Nothing' },
];
const HOURS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? '30' : '00';
  return { id: `${String(hour).padStart(2, '0')}:${minute}`, hour, minute };
});

/** The phone page uses the same preferences and mutations as the desktop settings. */
export function MobileCalendarSettingsPage(props: { onBack: () => void }) {
  const controls = createCalendarSettingsControls();
  const view = controls.calendarView;
  const [preferences, setPreferences] = useCalendarPreferences();
  const availability = useAvailabilitySettings();
  const sharing = useCalendarTeamSettings();
  const user = useUserId();
  const busy = useAvailabilityCalendarsQuery(user);
  const setBusy = useSetAvailabilityCalendarMutation();
  const [busyPage, setBusyPage] = createSignal(false);
  useAndroidBackNavigation(() => {
    if (!busyPage()) return false;
    setBusyPage(false);
    return true;
  });
  usePending('calendar.settings.availability', () => busy.isLoading);
  const busyCalendars = () => (busy.isSuccess ? busy.data.calendars : []);
  const startTime = createMemo(() => availability.settings().startTime);
  const endTime = createMemo(() => availability.settings().endTime);
  const timeOptions = (edge: 'start' | 'end', selected: string) => {
    const bounds = AVAILABILITY_TIME_BOUNDS[edge];
    return HOURS.filter(({ id, hour, minute }) => {
      const minutes = hour * 60 + Number(minute);
      // Preserve a valid older setting without expanding the offered workday range.
      return (
        id === selected || (minutes >= bounds.min && minutes <= bounds.max)
      );
    }).map(({ id, hour, minute }) => ({
      id,
      name:
        preferences.timeFormat === '24-hour'
          ? id
          : `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`,
    }));
  };
  const startOptions = createMemo(() => timeOptions('start', startTime()));
  const endOptions = createMemo(() => timeOptions('end', endTime()));
  const back = () => (busyPage() ? setBusyPage(false) : props.onBack());
  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main class="relative bg-page text-ink">
        <ViewShell.TopBar
          touch
          navigation={<MobileHeader.Back onBack={back} />}
        >
          <ViewShell.TopBarTitle>
            <h1 class="truncate px-3 text-base font-semibold">
              {busyPage() ? 'Busy calendars' : 'Calendar settings'}
            </h1>
          </ViewShell.TopBarTitle>
        </ViewShell.TopBar>
        <Layer depth={2}>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-[var(--mobile-content-inset-top,0px)] pb-[calc(var(--mobile-content-inset-bottom,0px)+2rem)]">
            <Show
              when={!busyPage()}
              fallback={
                <CalendarSettingsGroup title="Which calendars make you busy">
                  <Show when={busy.isError}>
                    <p role="alert" class="p-4">
                      Could not load busy calendars.
                      <Button
                        variant="ghost"
                        onClick={() =>
                          fireAndForget(busy.refetch(), 'calendar-settings')
                        }
                      >
                        Retry
                      </Button>
                    </p>
                  </Show>
                  <Show when={busy.isLoading}>
                    <p role="status" class="p-4">
                      Loading calendars…
                    </p>
                  </Show>
                  <For
                    each={view.sources().filter((source) => source.emailLinkId)}
                  >
                    {(source) => {
                      const value = () =>
                        busyCalendars().find(
                          (item) => item.calendarId === source.id
                        )?.contributesToAvailability;
                      return (
                        <CalendarSettingsRow>
                          <Checkbox
                            checked={value() === true}
                            indeterminate={value() === undefined}
                            disabled={
                              value() === undefined || setBusy.isPending
                            }
                            class="min-h-10 w-full gap-3"
                            onChange={(checked) => {
                              const userId = user();
                              if (!userId) return;
                              setBusy.mutate(
                                {
                                  userId,
                                  calendarIds: [source.id],
                                  contributesToAvailability: checked,
                                },
                                {
                                  onError: () =>
                                    toast.failure(
                                      'Could not save which calendars make you busy'
                                    ),
                                }
                              );
                            }}
                          >
                            <Checkbox.Control />
                            <Checkbox.Label class="min-w-0 flex-1">
                              {source.name}
                            </Checkbox.Label>
                          </Checkbox>
                        </CalendarSettingsRow>
                      );
                    }}
                  </For>
                </CalendarSettingsGroup>
              }
            >
              <div class="flex flex-col gap-5 py-2">
                <CalendarSettingsGroup title="Display">
                  <CalendarSettingsSwitch
                    label="Show weekends"
                    checked={view.displaySettings.showWeekends}
                    onChange={controls.changeShowWeekends}
                  />
                  <CalendarSettingsSelect
                    label="Week starts on"
                    value={String(view.displaySettings.weekStartsOn)}
                    options={[
                      { id: '0', name: 'Sunday' },
                      { id: '1', name: 'Monday' },
                    ]}
                    onChange={(value) =>
                      controls.changeWeekStartsOn(value === '1' ? 1 : 0)
                    }
                  />
                  <CalendarSettingsSelect
                    label="Time format"
                    value={view.displaySettings.timeFormat}
                    options={[
                      { id: '12-hour', name: '12-hour' },
                      { id: '24-hour', name: '24-hour' },
                    ]}
                    onChange={(value) =>
                      controls.changeTimeFormat(
                        value === '24-hour' ? '24-hour' : '12-hour'
                      )
                    }
                  />
                </CalendarSettingsGroup>
                <CalendarSettingsGroup title="Accounts">
                  <For each={controls.accounts()}>
                    {(account) => (
                      <CalendarSettingsRow>
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-base">
                            {account.emailAddress}
                          </div>
                          <div class="text-sm text-ink-muted">
                            {account.provider === 'GMAIL'
                              ? 'Google Calendar'
                              : 'Outlook Calendar'}
                          </div>
                        </div>
                        <Button
                          variant={
                            account.action === 'turnOff'
                              ? 'danger-ghost'
                              : 'ghost'
                          }
                          size="sm"
                          onClick={() => controls.runAccountAction(account)}
                        >
                          {account.action === 'turnOff'
                            ? 'Turn off'
                            : account.action === 'reconnect'
                              ? 'Reconnect'
                              : 'Enable'}
                        </Button>
                      </CalendarSettingsRow>
                    )}
                  </For>
                  <CalendarSettingsRow>
                    <Button
                      variant="ghost"
                      fullWidth
                      size="md"
                      class="justify-start"
                      onClick={controls.connectAnotherAccount}
                    >
                      <Plus class="size-5" />
                      Connect another account
                    </Button>
                  </CalendarSettingsRow>
                </CalendarSettingsGroup>
                <CalendarSettingsGroup title="Availability">
                  <CalendarSettingsSelect
                    label="Start time"
                    value={availability.settings().startTime}
                    options={startOptions()}
                    onChange={availability.setStartTime}
                  />
                  <CalendarSettingsSelect
                    label="End time"
                    value={availability.settings().endTime}
                    options={endOptions()}
                    onChange={availability.setEndTime}
                  />
                  <CalendarSettingsSwitch
                    label="Exclude weekends"
                    checked={availability.settings().excludeWeekends}
                    onChange={availability.setExcludeWeekends}
                  />
                  <CalendarSettingsRow>
                    <Button
                      variant="ghost"
                      size="md"
                      fullWidth
                      class="justify-between"
                      onClick={() => setBusyPage(true)}
                    >
                      <span>Busy calendars</span>
                      <span class="flex items-center gap-2 text-ink-muted">
                        {busy.isSuccess
                          ? busyCalendars().filter(
                              (calendar) => calendar.contributesToAvailability
                            ).length
                          : '…'}
                        <CaretRight class="size-5" />
                      </span>
                    </Button>
                  </CalendarSettingsRow>
                </CalendarSettingsGroup>
                <CalendarSettingsGroup title="Preferences">
                  <CalendarSettingsSwitch
                    label="Next meeting countdown"
                    checked={preferences.showNextMeetingBadge}
                    onChange={(value) =>
                      setPreferences('showNextMeetingBadge', value)
                    }
                  />
                  <Show when={sharing.enabled()}>
                    <Show
                      when={sharing.hasTeam && !sharing.error}
                      fallback={
                        <CalendarSettingsRow
                          label={
                            sharing.teamLoading
                              ? 'Loading team sharing…'
                              : sharing.error
                                ? 'Team sharing unavailable'
                                : 'Join a team to share your calendar'
                          }
                        >
                          <Show when={sharing.error}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={sharing.onRetry}
                            >
                              Retry
                            </Button>
                          </Show>
                        </CalendarSettingsRow>
                      }
                    >
                      <CalendarSettingsSelect
                        label="Share with teammates"
                        value={sharing.sharing}
                        options={SHARING_OPTIONS}
                        disabled={sharing.sharing === undefined}
                        onChange={(value) => {
                          if (
                            value === 'all' ||
                            value === 'none' ||
                            value === 'busy_only'
                          )
                            sharing.onChange(value);
                        }}
                      />
                    </Show>
                  </Show>
                </CalendarSettingsGroup>
              </div>
            </Show>
          </div>
        </Layer>
        <TurnOffCalendarDialog
          target={controls.turnOffTarget()}
          onClose={controls.clearTurnOffTarget}
        />
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
