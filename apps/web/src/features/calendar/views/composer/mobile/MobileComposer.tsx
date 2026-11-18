import { t } from '@app/lib/i18n';
import { SheetFooter } from '@components/app/mobile/sheet-footer/SheetFooter';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { triggerFocusInput } from '@core/directive/focusInput';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import TextIcon from '@icon/system/regular/text-align-left.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import {
  type Accessor,
  type ComponentProps,
  createSignal,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { ComposerSubmit } from '../../../components/composer/actions/ComposerSubmit';
import { ComposerCalendar } from '../../../components/composer/calendar/ComposerCalendar';
import { ComposerConference } from '../../../components/composer/conference/ComposerConference';
import { ComposerDescription } from '../../../components/composer/description/ComposerDescription';
import { ComposerLocation } from '../../../components/composer/location/ComposerLocation';
import { ComposerNotices } from '../../../components/composer/notices/ComposerNotices';
import { ComposerDecline } from '../../../components/composer/out-of-office/ComposerDecline';
import { ComposerDeclineMessage } from '../../../components/composer/out-of-office/ComposerDeclineMessage';
import { ComposerScope } from '../../../components/composer/scope/ComposerScope';
import { ComposerTimeZone } from '../../../components/composer/time-zone/ComposerTimeZone';
import { ComposerVisibility } from '../../../components/composer/visibility/ComposerVisibility';
import { ComposerWhenRoot } from '../../../components/composer/when/ComposerWhenRoot';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  type ComposerOptionalField,
  createComposerOptionalFields,
} from '../../../primitives/create-composer-optional-fields';
import { createComposerTitleVisibility } from '../../../primitives/create-composer-title-visibility';
import { MobileComposerCompactTitle } from './MobileComposerCompactTitle';
import { MobileComposerGuestPermissions } from './MobileComposerGuestPermissions';
import { MobileComposerGuests } from './MobileComposerGuests';
import { MobileComposerOptionalField } from './MobileComposerOptionalField';
import { MobileComposerReminders } from './MobileComposerReminders';
import { MobileComposerTitle } from './MobileComposerTitle';
import { PhoneWhen } from './PhoneWhen';

export interface MobileComposerProps {
  headerMount?: HTMLElement;
  footerMount?: HTMLElement;
  scrollElement: Accessor<HTMLElement | undefined>;
  macroCallsEnabled: boolean;
  titleIcon?: JSX.Element;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}

/** 2J is one flow of groups inside the host's scroller, with chrome portalled out. */
export function MobileComposer(props: ParentProps<MobileComposerProps>) {
  const model = useCalendarComposer();
  const [title, setTitle] = createSignal<HTMLElement>();
  const titleProgress = createComposerTitleVisibility(
    props.scrollElement,
    title
  );
  const fields = createComposerOptionalFields({
    value: (field) => model.state()[field],
    disabled: model.fieldIsDisabled,
  });
  let description: HTMLDivElement | undefined;
  let location: HTMLTextAreaElement | undefined;
  const reveal = (field: ComposerOptionalField, button: HTMLButtonElement) => {
    if (!fields.reveal(field)) return;
    triggerFocusInput(
      () => (field === 'description' ? description : location),
      button
    );
  };
  const optionalField = (field: ComposerOptionalField) => (
    <MobileComposerOptionalField
      field={field}
      label={t(
        field === 'description'
          ? 'calendar.addDescription'
          : 'calendar.addLocation'
      )}
      icon={
        field === 'description' ? (
          <TextIcon class="size-4" />
        ) : (
          <LocationIcon class="size-4" />
        )
      }
      visible={fields.visible(field)}
      empty={fields.empty(field)}
      disabled={model.fieldIsDisabled(field)}
      onReveal={(button) => reveal(field, button)}
      onFocus={() => fields.reveal(field)}
      onRemove={() => fields.remove(field)}
    >
      <Show
        when={field === 'description'}
        fallback={
          <ComposerLocation inputRef={(element) => (location = element)} />
        }
      >
        <ComposerDescription
          inputRef={(element) => (description = element)}
          resolveAppLink={props.resolveAppLink}
        />
      </Show>
    </MobileComposerOptionalField>
  );
  const footer = () => (
    <SheetFooter
      scrollElement={props.scrollElement}
      keyboardVisible={virtualKeyboardVisible()}
    >
      <ComposerScope />
      <Show when={props.saveError}>
        {(error) => (
          <p role="alert" class="pb-2 text-sm text-failure">
            {error()}
          </p>
        )}
      </Show>
      <ComposerSubmit fullWidth />
    </SheetFooter>
  );
  return (
    <ComposerWhenRoot>
      <Show when={props.headerMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <MobileComposerCompactTitle progress={titleProgress()} />
          </Portal>
        )}
      </Show>
      <div class="flex min-w-0 flex-col gap-4 px-5 pb-1">
        <MobileComposerTitle inputRef={setTitle} icon={props.titleIcon} />
        <PhoneWhen scrollElement={props.scrollElement} />
        <Show when={!model.isOutOfOffice()}>
          <Show when={fields.initiallyVisible('description')}>
            <SheetGroup>{optionalField('description')}</SheetGroup>
          </Show>
          <MobileComposerGuests />
        </Show>
        <SheetGroup>
          <Show when={!model.isOutOfOffice()}>
            <SheetRow icon={<VideoIcon class="size-4" />}>
              <ComposerConference
                provider={model.capabilities()?.conferenceProvider}
                value={model.state().conference}
                canKeepExisting={
                  model.controller.initialConferenceChoice() === 'existing'
                }
                macroCallsEnabled={props.macroCallsEnabled}
                onChange={(value) =>
                  model.controller.setField('conference', value)
                }
                disabled={model.fieldIsDisabled('conference')}
                fullWidth
              />
            </SheetRow>
            <Show when={fields.initiallyVisible('location')}>
              {optionalField('location')}
            </Show>
          </Show>
          <Show when={model.isOutOfOffice()}>
            <SheetRow>
              <ComposerDecline fullWidth />
            </SheetRow>
            <Show when={model.showsDeclineMessage()}>
              <SheetRow class="py-2">
                <ComposerDeclineMessage />
              </SheetRow>
            </Show>
          </Show>
          <SheetRow icon={<CalendarIcon class="size-4" />}>
            <ComposerCalendar fullWidth />
          </SheetRow>
        </SheetGroup>
        <Show
          when={
            !model.isOutOfOffice() &&
            (!fields.initiallyVisible('description') ||
              !fields.initiallyVisible('location'))
          }
        >
          <SheetGroup>
            <Show when={!fields.initiallyVisible('description')}>
              {optionalField('description')}
            </Show>
            <Show when={!fields.initiallyVisible('location')}>
              {optionalField('location')}
            </Show>
          </SheetGroup>
        </Show>
        <Show when={!model.state().allDay}>
          <SheetGroup>
            <SheetRow icon={<GlobeIcon class="size-4" />}>
              <ComposerTimeZone fullWidth />
            </SheetRow>
          </SheetGroup>
        </Show>
        <MobileComposerReminders
          minutes={model.controller.reminderMinutes()}
          canAdd={model.controller.canAddReminder()}
          preservedCount={model.controller.preservedReminderCount()}
          disabled={model.fieldIsDisabled('reminders')}
          onChange={model.controller.setReminderMinutes}
        />
        <Show when={model.showsGuestPolicy()}>
          <MobileComposerGuestPermissions />
        </Show>
        <SheetGroup>
          <SheetRow icon={<EyeIcon class="size-4" />}>
            <ComposerVisibility fullWidth />
          </SheetRow>
        </SheetGroup>
        <ComposerNotices />
        {props.children}
      </div>
      <Show when={props.footerMount} fallback={footer()}>
        {(mount) => <Portal mount={mount()}>{footer()}</Portal>}
      </Show>
    </ComposerWhenRoot>
  );
}
