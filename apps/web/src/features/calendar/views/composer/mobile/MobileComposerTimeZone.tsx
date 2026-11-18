import { timezoneOptions } from '@app/components/timezone-select/timezone-options';
import { formatLocale, t } from '@app/lib/i18n';
import GlobeIcon from '@icon/system/regular/globe.svg';
import { Input } from '@ui';
import { createMemo, createSignal, For } from 'solid-js';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

function TimeZoneChoices() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const [search, setSearch] = createSignal('');
  const options = timezoneOptions();
  // An imported zone can be valid without appearing in the runtime's enumeration.
  if (!options.some((option) => option.value === model.timeZone()))
    options.unshift({
      value: model.timeZone(),
      label: model.timeZone().replaceAll('_', ' '),
    });
  const filtered = createMemo(() =>
    options.filter((option) =>
      `${option.label} ${option.value} ${option.shortName ?? ''}`
        .toLowerCase()
        .includes(search().trim().toLowerCase())
    )
  );
  return (
    <>
      <Input
        variant="value"
        aria-label={t('calendar.timeZone')}
        placeholder={t('common.search')}
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="flex flex-col">
        <For each={filtered()}>
          {(option) => (
            <PhoneMenuChoice
              label={option.label}
              detail={option.shortName}
              selected={option.value === model.timeZone()}
              onChoose={() => {
                model.setTimeZone(option.value);
                menus.close();
              }}
            />
          )}
        </For>
      </div>
    </>
  );
}

export function MobileComposerTimeZone() {
  const model = useCalendarComposer();
  const label = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      timeZone: model.timeZone(),
      timeZoneName: 'short',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? model.timeZone();
  return (
    <PhoneMenu
      menu="time-zone"
      title={t('calendar.timeZone')}
      value={label()}
      icon={<GlobeIcon class="size-4" />}
      disabled={model.timeZoneIsDisabled()}
    >
      <TimeZoneChoices />
    </PhoneMenu>
  );
}
