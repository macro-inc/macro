import { t } from '@app/lib/i18n';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import { For, Show } from 'solid-js';
import { CalendarSwatch } from '../../../components/CalendarSwatch';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

export function MobileComposerCalendar() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const groups = () => [
    ...new Set(
      model.controller
        .calendarOptions()
        .map((calendar) => calendar.accountLabel)
    ),
  ];
  return (
    <PhoneMenu
      menu="calendar"
      title={t('calendar.composerCalendar')}
      icon={<CalendarIcon class="size-4" />}
      value={
        model.controller.selectedCalendarOption()?.label ??
        t('calendar.chooseCalendar')
      }
      disabled={model.isEdit() || model.fieldIsDisabled('calendar')}
    >
      <For each={groups()}>
        {(group) => (
          <div>
            <Show when={menus.pattern('calendar') === 'page' && group}>
              <h3 class="px-3 py-2 text-xs text-ink-subtle">{group}</h3>
            </Show>
            <For
              each={model.controller
                .calendarOptions()
                .filter((calendar) => calendar.accountLabel === group)}
            >
              {(calendar) => (
                <PhoneMenuChoice
                  label={calendar.name ?? calendar.label}
                  icon={<CalendarSwatch color={calendar.color} />}
                  selected={
                    calendar.id === model.controller.effectiveCalendarId()
                  }
                  onChoose={() => {
                    model.controller.setField('calendarId', calendar.id);
                    menus.close();
                  }}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </PhoneMenu>
  );
}
