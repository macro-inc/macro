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
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  desktopDateSummary,
  desktopSummaryDetails,
} from '../../../core/desktop-composer-summary';
import {
  type ComposerGroup,
  createComposerGroups,
} from '../../../primitives/create-composer-groups';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';
import {
  desktopGuestLabel,
  desktopReminderLabel,
} from '../../../utils/desktop-composer-labels';
import { CalendarSwatch } from '../../calendar-swatch/CalendarSwatch';
import { ComposerCalendar } from '../calendar/ComposerCalendar';
import { ComposerConference } from '../conference/ComposerConference';
import { ComposerDescription } from '../description/ComposerDescription';
import { ComposerKind } from '../kind/ComposerKind';
import { ComposerLocation } from '../location/ComposerLocation';
import { ComposerNotices } from '../notices/ComposerNotices';
import { ComposerDecline } from '../out-of-office/ComposerDecline';
import { ComposerDeclineMessage } from '../out-of-office/ComposerDeclineMessage';
import { ComposerGuestPermissions } from '../permissions/ComposerGuestPermissions';
import { ComposerTitle } from '../title/ComposerTitle';
import { ComposerVisibility } from '../visibility/ComposerVisibility';
import { CalendarComposerIdentity } from './CalendarComposerIdentity';
import { ComposerBusy } from './ComposerBusy';
import { ComposerGuestSelect } from './ComposerGuestSelect';
import { ComposerReminderSelect } from './ComposerReminderSelect';
import { DesktopDateGroup } from './DesktopDateGroup';

function FieldRow(props: { icon: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-start gap-3 py-0.5">
      <span
        aria-hidden="true"
        class="grid h-8 w-5 shrink-0 place-items-center text-ink-muted [&_svg]:size-4.5"
      >
        {props.icon}
      </span>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
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
      aria-label={
        typeof props.title === 'string'
          ? props.title
          : t('calendar.composerCalendar')
      }
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
  macroCallsEnabled: boolean;
  pinned?: boolean;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
  children?: JSX.Element;
}) {
  const model = useCalendarComposer();
  const controller = model.controller;
  const groups = createComposerGroups();
  const dateTitle = () =>
    desktopDateSummary(
      model.state().start,
      model.state().end,
      model.state().allDay,
      model.range.timeFormat ?? '12-hour',
      formatLocale()
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
        ? t('calendar.canSeeGuestList')
        : undefined
    );
  const calendarDetail = () =>
    desktopSummaryDetails(
      controller.reminderMinutes().length
        ? desktopReminderLabel(controller.reminderMinutes())
        : t('calendar.addReminder'),
      model.transparency() === 'transparent'
        ? t('calendar.free').toLowerCase()
        : t('calendar.busy').toLowerCase(),
      model.visibility() === 'private' || model.visibility() === 'confidential'
        ? t('calendar.visibilityPrivate').toLowerCase()
        : model.visibility() === 'public'
          ? t('calendar.visibilityPublic').toLowerCase()
          : t('calendar.visibilityDefaultSummary')
    );
  const date = () =>
    groups.isOpen('date') ? (
      <DesktopDateGroup pinned={props.pinned} />
    ) : (
      <Summary
        group="date"
        title={dateTitle()}
        detail={dateDetail()}
        onOpen={groups.open}
      />
    );
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-1 pb-3">
      <div class="flex flex-col gap-1">
        <Show
          when={model.isEdit()}
          fallback={
            <div class="pl-8 pt-0.5">
              <ComposerTitle />
            </div>
          }
        >
          <div class="flex items-start gap-3 pt-0.5">
            <span class="grid h-8 w-5 shrink-0 place-items-center">
              <CalendarComposerIdentity />
            </span>
            <div class="min-w-0 flex-1">
              <ComposerTitle />
            </div>
          </div>
          <div class="pl-8">{date()}</div>
        </Show>
        <Show when={!model.isEdit()}>
          <div class="pl-8 pt-1">
            <ComposerKind f3 />
          </div>
        </Show>
      </div>
      <div class="flex flex-col gap-3">
        <Show when={!model.isEdit()}>
          <FieldRow icon={<ClockIcon />}>{date()}</FieldRow>
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
            <FieldRow icon={<DescriptionIcon />}>
              <ComposerDescription
                plain
                resolveAppLink={props.resolveAppLink}
              />
            </FieldRow>
            <FieldRow icon={<UsersIcon />}>
              <Show
                when={groups.isOpen('guests')}
                fallback={
                  <Summary
                    group="guests"
                    title={desktopGuestLabel(model.guests.selected.length)}
                    detail={guestDetail()}
                    empty={model.guests.selected.length === 0}
                    onOpen={groups.open}
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
            </FieldRow>
            <FieldRow icon={<VideoIcon />}>
              <ComposerConference
                provider={model.capabilities()?.conferenceProvider}
                value={model.state().conference}
                canKeepExisting={
                  controller.initialConferenceChoice() === 'existing'
                }
                macroCallsEnabled={props.macroCallsEnabled}
                onChange={(value) => controller.setField('conference', value)}
                disabled={model.fieldIsDisabled('conference')}
              />
            </FieldRow>
            <FieldRow icon={<LocationIcon />}>
              <ComposerLocation plain />
            </FieldRow>
          </Match>
          <Match when={model.isOutOfOffice()}>
            <FieldRow icon={<CalendarIcon />}>
              <ComposerDecline />
            </FieldRow>
            <Show when={model.showsDeclineMessage()}>
              <FieldRow icon={<DescriptionIcon />}>
                <ComposerDeclineMessage />
              </FieldRow>
            </Show>
          </Match>
        </Switch>
        <Show
          when={groups.isOpen('calendar')}
          fallback={
            <FieldRow icon={<CalendarIcon />}>
              <Summary
                group="calendar"
                title={
                  <span class="flex min-h-6 items-center gap-2">
                    <CalendarSwatch
                      color={
                        controller.selectedCalendarOption()?.color ??
                        DEFAULT_CALENDAR_SOURCE.color
                      }
                      class="rounded-[3px]"
                    />
                    {controller.selectedCalendarOption()?.label ??
                      t('calendar.chooseCalendar')}
                  </span>
                }
                detail={calendarDetail()}
                onOpen={groups.open}
              />
            </FieldRow>
          }
        >
          <FieldRow icon={<CalendarIcon />}>
            <ComposerCalendar size="md" />
          </FieldRow>
          <FieldRow icon={<BellIcon />}>
            <ComposerReminderSelect />
          </FieldRow>
          <FieldRow icon={<EyeIcon />}>
            <ComposerVisibility size="md" />
          </FieldRow>
          <FieldRow icon={<BriefcaseIcon />}>
            <ComposerBusy />
          </FieldRow>
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
