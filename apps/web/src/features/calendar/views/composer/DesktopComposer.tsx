import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import DescriptionIcon from '@icon/system/regular/text-align-left.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import {
  type ComponentProps,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { ComposerGuests } from '../../components/composer/guests/ComposerGuests';
import { ComposerCalendar } from '../../components/composer/parts/ComposerCalendar';
import { ComposerConference } from '../../components/composer/parts/ComposerConference';
import { ComposerDecline } from '../../components/composer/parts/ComposerDecline';
import { ComposerDeclineMessage } from '../../components/composer/parts/ComposerDeclineMessage';
import type { ComposerDescription } from '../../components/composer/parts/ComposerDescription';
import { ComposerFieldRow } from '../../components/composer/parts/ComposerFieldRow';
import { ComposerKind } from '../../components/composer/parts/ComposerKind';
import { ComposerNotices } from '../../components/composer/parts/ComposerNotices';
import { ComposerTitle } from '../../components/composer/parts/ComposerTitle';
import { DesktopOptionalField } from '../../components/composer/parts/DesktopOptionalField';
import { ComposerRecurrence } from '../../components/composer/recurrence/ComposerRecurrence';
import { DesktopWhen } from '../../components/composer/when/DesktopWhen';
import { useCalendarComposer } from '../../context/calendar-composer-context';

export interface DesktopComposerProps {
  titleIcon?: JSX.Element;
  options?: JSX.Element;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}
/** Shared fields only. Placement views own their chrome and optional sections. */
export function DesktopComposer(props: ParentProps<DesktopComposerProps>) {
  const model = useCalendarComposer();
  const controller = model.controller;
  const descriptionInMainFields =
    !model.isEdit() || Boolean(controller.initialValue().description);
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-1 pb-3">
      <ComposerFieldRow class="py-0" icon={props.titleIcon}>
        <div class="flex flex-col gap-1.5">
          <ComposerTitle />
          <Show when={!model.isEdit()}>
            <ComposerKind />
          </Show>
        </div>
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
              <DesktopOptionalField
                field="description"
                resolveAppLink={props.resolveAppLink}
              />
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
              onChange={(value) => controller.setField('conference', value)}
              disabled={model.fieldIsDisabled('conference')}
            />
          </ComposerFieldRow>
          <ComposerFieldRow icon={<LocationIcon class="size-4" />}>
            <DesktopOptionalField field="location" />
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
      {props.options}
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
  );
}
