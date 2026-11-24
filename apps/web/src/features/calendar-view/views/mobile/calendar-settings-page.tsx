import { ViewShell } from '@app/components/view-shell';
import { AVAILABILITY_TIME_BOUNDS } from '@app/features/calendar/availability/availability';
import { useAvailabilitySettings } from '@app/features/calendar/availability/settings';
import { availabilityTimeOptions } from '@app/features/calendar/availability/time-options';
import { createCalendarSettingsControls } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { TurnOffCalendarDialog } from '@app/features/calendar/components/TurnOffCalendarDialog';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useCalendarTeamSettings } from '@app/features/calendar-team/calendar-team';
import { calendarSharingOptions } from '@app/features/calendar-team/components/team-sharing-settings';
import { t } from '@app/lib/i18n';
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
    return availabilityTimeOptions(0, 23.5, preferences.timeFormat)
      .filter(({ value }) => {
        const [hour, minute] = value.split(':').map(Number);
        const minutes = hour * 60 + minute;
        return (
          value === selected || (minutes >= bounds.min && minutes <= bounds.max)
        );
      })
      .map(({ value, label }) => ({ id: value, name: label }));
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
              {busyPage()
                ? t('calendar.busyCalendars')
                : t('calendar.settingsTitle')}
            </h1>
          </ViewShell.TopBarTitle>
        </ViewShell.TopBar>
        <Layer depth={2}>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-[var(--mobile-content-inset-top,0px)] pb-[calc(var(--mobile-content-inset-bottom,0px)+2rem)]">
            <Show
              when={!busyPage()}
              fallback={
                <CalendarSettingsGroup title={t('calendar.busyCalendarsTitle')}>
                  <Show when={busy.isError}>
                    <p role="alert" class="p-4">
                      {t('calendar.busyCalendarsError')}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          fireAndForget(busy.refetch(), 'calendar-settings')
                        }
                      >
                        {t('common.retry')}
                      </Button>
                    </p>
                  </Show>
                  <Show when={busy.isLoading}>
                    <p role="status" class="p-4">
                      {t('calendar.loadingCalendars')}
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
                                      t('calendar.busyCalendarsSaveError')
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
                <CalendarSettingsGroup title={t('calendar.display')}>
                  <CalendarSettingsSwitch
                    label={t('calendar.showWeekends')}
                    checked={view.displaySettings.showWeekends}
                    onChange={controls.changeShowWeekends}
                  />
                  <CalendarSettingsSelect
                    label={t('calendar.weekStartsOn')}
                    value={String(view.displaySettings.weekStartsOn)}
                    options={[
                      { id: '0', name: t('calendar.sunday') },
                      { id: '1', name: t('calendar.monday') },
                    ]}
                    onChange={(value) =>
                      controls.changeWeekStartsOn(value === '1' ? 1 : 0)
                    }
                  />
                  <CalendarSettingsSelect
                    label={t('calendar.timeFormat')}
                    value={view.displaySettings.timeFormat}
                    options={[
                      { id: '12-hour', name: t('calendar.twelveHour') },
                      { id: '24-hour', name: t('calendar.twentyFourHour') },
                    ]}
                    onChange={(value) =>
                      controls.changeTimeFormat(
                        value === '24-hour' ? '24-hour' : '12-hour'
                      )
                    }
                  />
                </CalendarSettingsGroup>
                <CalendarSettingsGroup title={t('calendar.accounts')}>
                  <For each={controls.accounts()}>
                    {(account) => (
                      <CalendarSettingsRow>
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-base">
                            {account.emailAddress}
                          </div>
                          <div class="text-sm text-ink-muted">
                            {account.provider === 'GMAIL'
                              ? t('calendar.googleCalendar')
                              : t('calendar.outlookCalendar')}
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
                            ? t('calendar.turnOff')
                            : account.action === 'reconnect'
                              ? t('calendar.reconnect')
                              : t('calendar.enable')}
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
                      {t('viewMenus.connectAnotherAccount')}
                    </Button>
                  </CalendarSettingsRow>
                </CalendarSettingsGroup>
                <CalendarSettingsGroup title={t('calendar.availability')}>
                  <CalendarSettingsSelect
                    label={t('calendar.settingsStartTime')}
                    value={availability.settings().startTime}
                    options={startOptions()}
                    onChange={availability.setStartTime}
                  />
                  <CalendarSettingsSelect
                    label={t('calendar.settingsEndTime')}
                    value={availability.settings().endTime}
                    options={endOptions()}
                    onChange={availability.setEndTime}
                  />
                  <CalendarSettingsSwitch
                    label={t('calendar.excludeWeekends')}
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
                      <span>{t('calendar.busyCalendars')}</span>
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
                <CalendarSettingsGroup title={t('calendar.preferences')}>
                  <CalendarSettingsSwitch
                    label={t('calendar.meetingCountdown')}
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
                              ? t('calendar.loadingTeamSharing')
                              : sharing.error
                                ? t('calendar.teamSharingUnavailable')
                                : t('calendar.joinTeamToShare')
                          }
                        >
                          <Show when={sharing.error}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={sharing.onRetry}
                            >
                              {t('common.retry')}
                            </Button>
                          </Show>
                        </CalendarSettingsRow>
                      }
                    >
                      <CalendarSettingsSelect
                        label={t('calendar.shareWithTeammates')}
                        value={sharing.sharing}
                        options={calendarSharingOptions()}
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
