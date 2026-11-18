import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import VisibilityIcon from '@icon/system/regular/eye.svg';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import AgentMark from '@icon/system/regular/sparkle.svg';
import DescriptionIcon from '@icon/system/regular/text-align-left.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import { Button } from '@ui';
import {
  type ComponentProps,
  createSignal,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { CalendarSwatch } from '../../components/calendar-swatch/CalendarSwatch';
import { ComposerCancel } from '../../components/composer/actions/ComposerCancel';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { ComposerPin } from '../../components/composer/actions/ComposerPin';
import { ComposerSubmit } from '../../components/composer/actions/ComposerSubmit';
import { ComposerCalendar } from '../../components/composer/calendar/ComposerCalendar';
import { ComposerConference } from '../../components/composer/conference/ComposerConference';
import { ComposerDescription } from '../../components/composer/description/ComposerDescription';
import { ComposerFieldRow } from '../../components/composer/field-row/ComposerFieldRow';
import { ComposerGuests } from '../../components/composer/guests/ComposerGuests';
import { ComposerHeader } from '../../components/composer/header/ComposerHeader';
import { ComposerKind } from '../../components/composer/kind/ComposerKind';
import { ComposerLocation } from '../../components/composer/location/ComposerLocation';
import { ComposerNotices } from '../../components/composer/notices/ComposerNotices';
import { ComposerDecline } from '../../components/composer/out-of-office/ComposerDecline';
import { ComposerDeclineMessage } from '../../components/composer/out-of-office/ComposerDeclineMessage';
import { ComposerGuestPermissions } from '../../components/composer/permissions/ComposerGuestPermissions';
import { ComposerRecurrence } from '../../components/composer/recurrence/ComposerRecurrence';

import { ComposerReminders } from '../../components/composer/reminders/ComposerReminders';
import { ComposerScope } from '../../components/composer/scope/ComposerScope';
import { ComposerTitle } from '../../components/composer/title/ComposerTitle';
import { ComposerVisibility } from '../../components/composer/visibility/ComposerVisibility';
import { ComposerWhenRoot } from '../../components/composer/when/ComposerWhenRoot';
import { DesktopWhen } from '../../components/composer/when/DesktopWhen';
import { useCalendarComposer } from '../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../types';

interface DesktopComposerProps {
  pinned?: boolean;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onClose: () => void;
  onCancel: () => void;
  macroCallsEnabled: boolean;
  agentDraft?: boolean;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}

/** Desktop layout only; the surrounding Root and placement host retain the model. */
export function DesktopComposer(props: ParentProps<DesktopComposerProps>) {
  const model = useCalendarComposer();
  const [expanded, setExpanded] = createSignal(false);
  const showOptions = () => props.pinned || expanded();
  const controller = model.controller;
  // Keep newly revealed fields at the end even after they receive a value.
  const descriptionInMainFields =
    !model.isEdit() || Boolean(controller.initialValue().description);

  return (
    <ComposerWhenRoot>
      <ComposerHeader onPointerDown={props.onHeaderPointerDown}>
        <div class="flex-1" />
        <Show when={props.onTogglePin}>
          {(toggle) => (
            <ComposerPin
              pinned={props.pinned ?? false}
              onToggle={toggle()}
              disabled={model.formIsDisabled()}
            />
          )}
        </Show>
        <ComposerClose onClose={props.onClose} />
      </ComposerHeader>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-1 pb-3">
        <ComposerFieldRow
          class="py-0"
          icon={
            <Show
              when={props.agentDraft}
              fallback={
                <Show when={model.isEdit()}>
                  <CalendarSwatch
                    color={
                      controller.selectedCalendarOption()?.color ??
                      DEFAULT_CALENDAR_SOURCE.color
                    }
                  />
                </Show>
              }
            >
              <AgentMark class="size-4 text-ink-muted" />
            </Show>
          }
        >
          <ComposerTitle />
          <Show when={!model.isEdit()}>
            <div class="mt-1.5">
              <ComposerKind />
            </div>
          </Show>
        </ComposerFieldRow>
        <ComposerFieldRow icon={<ClockIcon class="size-4" />}>
          <DesktopWhen />
        </ComposerFieldRow>
        <ComposerFieldRow icon={<RepeatIcon class="size-4" />}>
          <ComposerRecurrence />
        </ComposerFieldRow>
        <Show when={model.recurrenceScopeReason()}>
          {(reason) => (
            <p
              id={model.ids.recurrenceReason}
              class="pl-[30px] text-xs text-ink-muted"
            >
              {reason()}
            </p>
          )}
        </Show>
        <Switch>
          <Match when={!model.isOutOfOffice()}>
            <Show when={descriptionInMainFields}>
              <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
                <ComposerDescription resolveAppLink={props.resolveAppLink} />
              </ComposerFieldRow>
            </Show>
            <ComposerFieldRow icon={<UsersIcon class="size-3.5" />}>
              <ComposerGuests />
            </ComposerFieldRow>
            <ComposerFieldRow icon={<VideoIcon class="size-4" />}>
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
            </ComposerFieldRow>
            <ComposerFieldRow icon={<LocationIcon class="size-4" />}>
              <ComposerLocation />
            </ComposerFieldRow>
          </Match>
          <Match when={model.isOutOfOffice()}>
            <ComposerFieldRow icon={<CalendarIcon class="size-4" />}>
              <ComposerDecline />
            </ComposerFieldRow>
            <Show when={model.showsDeclineMessage()}>
              <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
                <ComposerDeclineMessage />
              </ComposerFieldRow>
            </Show>
          </Match>
        </Switch>
        <ComposerFieldRow icon={<CalendarIcon class="size-4" />}>
          <ComposerCalendar />
        </ComposerFieldRow>
        <Show when={showOptions()}>
          <Show when={!descriptionInMainFields && !model.isOutOfOffice()}>
            <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
              <ComposerDescription resolveAppLink={props.resolveAppLink} />
            </ComposerFieldRow>
          </Show>
          <ComposerFieldRow icon={<BellIcon class="size-4" />}>
            <ComposerReminders
              minutes={controller.reminderMinutes()}
              canAdd={controller.canAddReminder()}
              preservedCount={controller.preservedReminderCount()}
              disabled={model.fieldIsDisabled('reminders')}
              onChange={controller.setReminderMinutes}
            />
          </ComposerFieldRow>
          <Show when={model.showsGuestPolicy()}>
            <ComposerFieldRow icon={<ShieldIcon class="size-4" />}>
              <ComposerGuestPermissions {...model.guestPolicy} />
            </ComposerFieldRow>
          </Show>
          <ComposerFieldRow icon={<VisibilityIcon class="size-4" />}>
            <ComposerVisibility />
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
      <div class="shrink-0 px-4 pb-2">
        <ComposerScope />
      </div>
      <div class="flex shrink-0 items-center gap-2 border-t border-divider pt-2.5 pr-3 pb-3.5 pl-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showOptions()}
          onClick={() => setExpanded((open) => !open)}
          disabled={props.pinned}
        >
          {showOptions()
            ? t('calendar.fewerOptions')
            : t('calendar.moreOptions')}
          <CaretDownIcon
            class="size-3"
            classList={{ 'rotate-180': showOptions() }}
          />
        </Button>
        <div class="flex-1" />
        <ComposerCancel onCancel={props.onCancel} />
        <ComposerSubmit />
      </div>
    </ComposerWhenRoot>
  );
}
