import { t } from '@app/lib/i18n';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import { For } from 'solid-js';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import { createComposerConference } from '../../../primitives/create-composer-conference';

export function MobileComposerConference() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const conference = createComposerConference({
    provider: () => model.capabilities()?.conferenceProvider,
    value: () => model.state().conference,
    canKeepExisting: () =>
      model.controller.initialConferenceChoice() === 'existing',
    disabled: () => model.fieldIsDisabled('conference'),
    onChange: (value) => model.controller.setField('conference', value),
  });
  return (
    <PhoneMenu
      menu="call"
      title={t('calendar.conferencing')}
      icon={<VideoIcon class="size-4" />}
      value={
        model.state().conference === 'none'
          ? t('calendar.addMeetingLink')
          : conference.selected()?.label
      }
      placeholder={model.state().conference === 'none'}
      disabled={model.fieldIsDisabled('conference')}
    >
      <For each={conference.choices()}>
        {(choice) => (
          <PhoneMenuChoice
            label={choice.label}
            selected={choice.value === model.state().conference}
            onChoose={() => {
              conference.choose(choice.value);
              menus.close();
            }}
          />
        )}
      </For>
    </PhoneMenu>
  );
}
