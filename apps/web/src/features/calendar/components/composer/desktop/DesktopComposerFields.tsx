import { formatLocale, t } from '@app/lib/i18n';
import { parseLocalDate } from '@core/util/local-date';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import DescriptionIcon from '@icon/system/regular/text-align-left.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import BriefcaseIcon from '@macro-inc/entity-icons/svg/briefcase.svg';
import { type ComponentProps, type JSX, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { whenSummary } from '../../../core/when-summary';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';
import { formatReminderOffset } from '../../../utils/event-reminders';
import { CalendarSwatch } from '../../CalendarSwatch';
import { ComposerCalendar } from '../parts/ComposerCalendar';
import { ComposerConference } from '../parts/ComposerConference';
import { ComposerDecline } from '../parts/ComposerDecline';
import { ComposerDeclineMessage } from '../parts/ComposerDeclineMessage';
import { ComposerDescription } from '../parts/ComposerDescription';
import { ComposerFieldRow } from '../parts/ComposerFieldRow';
import { ComposerGuestPermissions } from '../parts/ComposerGuestPermissions';
import { ComposerKind } from '../parts/ComposerKind';
import { ComposerLocation } from '../parts/ComposerLocation';
import { ComposerNotices } from '../parts/ComposerNotices';
import { ComposerTitle } from '../parts/ComposerTitle';
import { ComposerVisibility } from '../parts/ComposerVisibility';
import { CalendarComposerIdentity } from './CalendarComposerIdentity';
import { ComposerBusy } from './ComposerBusy';
import { ComposerGuestSelect } from './ComposerGuestSelect';
import { ComposerReminderSelect } from './ComposerReminderSelect';
import { DesktopDateGroup } from './DesktopDateGroup';

type ComposerGroup = 'date' | 'guests' | 'calendar';

function desktopSummaryDetails(...parts: (string | undefined)[]) {
  return parts.filter((part) => part !== undefined && part !== '').join(', ');
}

function Summary(props: {
  group: ComposerGroup;
  title: JSX.Element;
  detail: string;
  onOpen: (group: ComposerGroup) => void;
  empty?: boolean;
}) {
  return (
    <button
      type="button"
      class="flex w-full flex-col items-start gap-0 rounded-lg py-1 pr-2.5 pl-3 text-left hover:bg-hover focus-visible:bg-active focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => props.onOpen(props.group)}
    >
      <span
        class="min-h-5 text-sm"
        classList={{ 'text-ink-extra-muted': props.empty }}
      >
        {props.title}
      </span>
      <span class="text-xs text-ink-muted">{props.detail}</span>
    </button>
  );
}

export function DesktopComposerFields(props: {
  pinned?: boolean;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
  children?: JSX.Element;
}) {
  const model = useCalendarComposer();
  const controller = model.controller;
  const [openGroups, setOpenGroups] = createStore<
    Record<ComposerGroup, boolean>
  >({ date: false, guests: false, calendar: false });
  const openGroup = (group: ComposerGroup) => setOpenGroups(group, true);
  const dateTitle = () =>
    whenSummary(
      model.state().start,
      model.state().end,
      model.state().allDay,
      model.range.timeFormat ?? '12-hour',
      formatLocale(),
      ', '
    );
  const dateDetail = () =>
    desktopSummaryDetails(
      model.state().allDay
        ? undefined
        : new Intl.DateTimeFormat(formatLocale(), {
            timeZone: model.timeZone(),
            timeZoneName: 'short',
          })
            .formatToParts(
              parseLocalDate(model.state().start.slice(0, 10)) ?? new Date()
            )
            .find((part) => part.type === 'timeZoneName')?.value,
      controller.selectedRecurrenceOption().label.toLowerCase()
    );
  const guestDetail = () =>
    desktopSummaryDetails(
      model.guestPolicy.value.canInviteOthers
        ? t('calendar.canInviteOthers')
        : undefined,
      model.guestPolicy.value.canSeeOtherGuests
        ? t('calendar.seeGuestList')
        : undefined
    );
  const calendarDetail = () =>
    desktopSummaryDetails(
      controller.reminderMinutes().length
        ? controller.reminderMinutes().map(formatReminderOffset).join(', ')
        : t('calendar.addReminder'),
      model.transparency() === 'transparent'
        ? t('calendar.free').toLowerCase()
        : t('calendar.busy').toLowerCase(),
      match(model.visibility())
        .with('private', 'confidential', () =>
          t('calendar.visibilityPrivate').toLowerCase()
        )
        .with('public', () => t('calendar.visibilityPublic').toLowerCase())
        .otherwise(() => t('calendar.visibilityDefaultSummary'))
    );
  const date = () =>
    openGroups.date ? (
      <DesktopDateGroup pinned={props.pinned} />
    ) : (
      <Summary
        group="date"
        title={dateTitle()}
        detail={dateDetail()}
        onOpen={openGroup}
      />
    );
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-1 pb-3">
      <div class="flex flex-col gap-1">
        <Switch>
          <Match when={model.isEdit()}>
            <div class="flex items-start gap-3 pt-0.5">
              <span class="grid h-8 w-5 shrink-0 place-items-center">
                <CalendarComposerIdentity />
              </span>
              <div class="min-w-0 flex-1">
                <ComposerTitle />
              </div>
            </div>
            <div class="pl-8">{date()}</div>
          </Match>
          <Match when={!model.isEdit()}>
            <div class="pl-8 pt-0.5">
              <ComposerTitle />
            </div>
            <div class="pl-8 pt-1">
              <ComposerKind f3 />
            </div>
          </Match>
        </Switch>
      </div>
      <div class="flex flex-col gap-3">
        <Show when={!model.isEdit()}>
          <ComposerFieldRow size="md" icon={<ClockIcon class="size-4.5" />}>
            {date()}
          </ComposerFieldRow>
        </Show>
        <Show when={model.recurrenceScopeReason()}>
          {(reason) => (
            <p
              id={model.ids.recurrenceReason}
              class="pl-8 text-xs text-ink-muted"
            >
              {reason()}
            </p>
          )}
        </Show>
        <Switch>
          <Match when={!model.isOutOfOffice()}>
            <ComposerFieldRow
              size="md"
              icon={<DescriptionIcon class="size-4.5" />}
            >
              <ComposerDescription
                plain
                resolveAppLink={props.resolveAppLink}
              />
            </ComposerFieldRow>
            <ComposerFieldRow size="md" icon={<UsersIcon class="size-4.5" />}>
              <Show
                when={openGroups.guests}
                fallback={
                  <Summary
                    group="guests"
                    title={
                      model.guests.selected.length
                        ? t('calendar.searchGuests', {
                            count: model.guests.selected.length,
                          })
                        : t('calendar.guestSummaryEmpty')
                    }
                    detail={guestDetail()}
                    empty={model.guests.selected.length === 0}
                    onOpen={openGroup}
                  />
                }
              >
                <div class="flex flex-col gap-2">
                  <ComposerGuestSelect />
                  <Show when={model.showsGuestPolicy()}>
                    <ComposerGuestPermissions {...model.guestPolicy} />
                  </Show>
                </div>
              </Show>
            </ComposerFieldRow>
            <ComposerFieldRow size="md" icon={<VideoIcon class="size-4.5" />}>
              <ComposerConference
                provider={model.capabilities()?.conferenceProvider}
                value={model.state().conference}
                canKeepExisting={
                  controller.initialConferenceChoice() === 'existing'
                }
                onChange={(value) => controller.setField('conference', value)}
                disabled={model.fieldIsDisabled('conference')}
              />
            </ComposerFieldRow>
            <ComposerFieldRow
              size="md"
              icon={<LocationIcon class="size-4.5" />}
            >
              <ComposerLocation plain />
            </ComposerFieldRow>
          </Match>
          <Match when={model.isOutOfOffice()}>
            <ComposerFieldRow
              size="md"
              icon={<CalendarIcon class="size-4.5" />}
            >
              <ComposerDecline />
            </ComposerFieldRow>
            <Show when={model.showsDeclineMessage()}>
              <ComposerFieldRow
                size="md"
                icon={<DescriptionIcon class="size-4.5" />}
              >
                <ComposerDeclineMessage />
              </ComposerFieldRow>
            </Show>
          </Match>
        </Switch>
        <Show
          when={openGroups.calendar}
          fallback={
            <ComposerFieldRow
              size="md"
              icon={<CalendarIcon class="size-4.5" />}
            >
              <Summary
                group="calendar"
                title={
                  <span class="flex min-h-6 items-center gap-2">
                    <CalendarSwatch
                      color={
                        controller.selectedCalendarOption()?.color ??
                        DEFAULT_CALENDAR_SOURCE.color
                      }
                      class="rounded-sm"
                    />
                    {controller.selectedCalendarOption()?.label ??
                      t('calendar.chooseCalendar')}
                  </span>
                }
                detail={calendarDetail()}
                onOpen={openGroup}
              />
            </ComposerFieldRow>
          }
        >
          <ComposerFieldRow size="md" icon={<CalendarIcon class="size-4.5" />}>
            <ComposerCalendar size="md" />
          </ComposerFieldRow>
          <ComposerFieldRow size="md" icon={<BellIcon class="size-4.5" />}>
            <ComposerReminderSelect />
          </ComposerFieldRow>
          <ComposerFieldRow size="md" icon={<EyeIcon class="size-4.5" />}>
            <ComposerVisibility size="md" />
          </ComposerFieldRow>
          <ComposerFieldRow size="md" icon={<BriefcaseIcon class="size-4.5" />}>
            <ComposerBusy />
          </ComposerFieldRow>
        </Show>
        <ComposerNotices />
        {props.children}
        <Show when={props.saveError}>
          {(error) => (
            <p role="alert" class="text-sm text-failure">
              {error()}
            </p>
          )}
        </Show>
      </div>
    </div>
  );
}
