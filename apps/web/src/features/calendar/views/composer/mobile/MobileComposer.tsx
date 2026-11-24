import { t } from '@app/lib/i18n';
import { SheetFooter } from '@components/app/mobile/SheetFooter';
import { SheetGroup } from '@components/app/mobile/SheetGroup';
import { SheetRow } from '@components/app/mobile/SheetRow';
import { triggerFocusInput } from '@core/directive/focusInput';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import LocationIcon from '@icon/system/regular/map-pin.svg';
import TextIcon from '@icon/system/regular/text-align-left.svg';
import {
  type Accessor,
  type ComponentProps,
  createSignal,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { ComposerSubmit } from '../../../components/composer/actions/ComposerSubmit';
import { ComposerDeclineMessage } from '../../../components/composer/parts/ComposerDeclineMessage';
import { ComposerDescription } from '../../../components/composer/parts/ComposerDescription';
import { ComposerLocation } from '../../../components/composer/parts/ComposerLocation';
import { ComposerNotices } from '../../../components/composer/parts/ComposerNotices';
import { ComposerScope } from '../../../components/composer/parts/ComposerScope';
import { PhoneComposerMenuRoot } from '../../../components/composer/phone-menu/PhoneComposerMenuRoot';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import {
  type ComposerOptionalField,
  createComposerOptionalFields,
} from '../../../primitives/create-composer-optional-fields';
import { createComposerTitleVisibility } from '../../../primitives/create-composer-title-visibility';
import { MobileComposerCalendar } from './MobileComposerCalendar';
import { MobileComposerCompactTitle } from './MobileComposerCompactTitle';
import { MobileComposerConference } from './MobileComposerConference';
import { MobileComposerDecline } from './MobileComposerDecline';
import { MobileComposerGuestPermissions } from './MobileComposerGuestPermissions';
import { MobileComposerGuests } from './MobileComposerGuests';
import { MobileComposerOptionalField } from './MobileComposerOptionalField';
import { MobileComposerReminders } from './MobileComposerReminders';
import { MobileComposerTitle } from './MobileComposerTitle';
import { MobileComposerVisibility } from './MobileComposerVisibility';
import { PhoneWhen } from './PhoneWhen';

export interface MobileComposerProps {
  headerMount?: HTMLElement;
  footerMount?: HTMLElement;
  scrollElement: Accessor<HTMLElement | undefined>;
  titleIcon?: JSX.Element;
  saveError?: string;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}

/** 2J is one flow of groups inside the host's scroller, with chrome portalled out. */
function MobileComposerFields(props: ParentProps<MobileComposerProps>) {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
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
          <ComposerLocation
            inputRef={(element) => (location = element)}
            rows={2}
          />
        }
      >
        <ComposerDescription
          minLines={3}
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
    <>
      <Show when={!menus.page() && props.headerMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <MobileComposerCompactTitle progress={titleProgress()} />
          </Portal>
        )}
      </Show>
      <div
        class="flex min-w-0 flex-col gap-4 px-5 pb-1"
        style={{ display: menus.page() ? 'none' : undefined }}
      >
        <MobileComposerTitle inputRef={setTitle} icon={props.titleIcon} />
        <PhoneWhen scrollElement={props.scrollElement} />
        <Show when={!model.isOutOfOffice()}>
          <Show when={fields.initiallyVisible('description')}>
            <SheetGroup>{optionalField('description')}</SheetGroup>
          </Show>
          <MobileComposerGuests />
        </Show>
        <SheetGroup>
          <Switch>
            <Match when={!model.isOutOfOffice()}>
              <MobileComposerConference />
              <Show when={fields.initiallyVisible('location')}>
                {optionalField('location')}
              </Show>
            </Match>
            <Match when={model.isOutOfOffice()}>
              <MobileComposerDecline />
              <Show when={model.showsDeclineMessage()}>
                <SheetRow class="py-2">
                  <ComposerDeclineMessage />
                </SheetRow>
              </Show>
            </Match>
          </Switch>
          <MobileComposerCalendar />
          <MobileComposerReminders
            minutes={model.controller.reminderMinutes()}
            canAdd={model.controller.canAddReminder()}
            preservedCount={model.controller.preservedReminderCount()}
            disabled={model.fieldIsDisabled('reminders')}
            onChange={model.controller.setReminderMinutes}
          />
          <MobileComposerVisibility />
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
        <Show when={model.showsGuestPolicy()}>
          <MobileComposerGuestPermissions />
        </Show>
        <ComposerNotices />
        {props.children}
      </div>
      <Show when={!menus.page()}>
        <Show when={props.footerMount} fallback={footer()}>
          {(mount) => <Portal mount={mount()}>{footer()}</Portal>}
        </Show>
      </Show>
    </>
  );
}

export function MobileComposer(props: ParentProps<MobileComposerProps>) {
  return (
    <PhoneComposerMenuRoot scrollElement={props.scrollElement}>
      <MobileComposerFields {...props} />
    </PhoneComposerMenuRoot>
  );
}
