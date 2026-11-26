import { t } from '@app/lib/i18n';
import { TraceFlow } from '@app/observability/flow';
import UsersIcon from '@icon/system/regular/users.svg';
import { Show } from 'solid-js';
import type { SelectedEventEditorGuest } from '../../../components/composer/event-form-model';
import { PhoneMenuTrigger } from '../../../components/composer/phone-menu/PhoneMenuTrigger';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import { MobileComposerPeoplePage } from './MobileComposerPeoplePage';

/** Mount this part only while guest editing is permitted, so losing permission drops the session. */
export function MobileComposerGuestPicker(props: {
  current: () => SelectedEventEditorGuest[];
  added: () => SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
  showIcon: boolean;
}) {
  const menus = usePhoneComposerMenu();

  return (
    <>
      <PhoneMenuTrigger
        menu="people"
        title={t('calendar.addGuests')}
        value={t('calendar.addGuests')}
        placeholder
        icon={
          <Show when={props.showIcon}>
            <UsersIcon class="size-4" />
          </Show>
        }
      />
      <Show when={menus.when.state.active === 'people'}>
        <TraceFlow name="calendar.composer.people">
          <MobileComposerPeoplePage
            current={props.current}
            added={props.added}
            onAddedChange={props.onAddedChange}
          />
        </TraceFlow>
      </Show>
    </>
  );
}
