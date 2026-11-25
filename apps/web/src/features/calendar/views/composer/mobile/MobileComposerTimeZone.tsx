import {
  shortTimeZoneLabel,
  timezoneOptions,
  timezoneOptionsWithCurrent,
} from '@app/components/timezone-select/timezone-options';
import { formatLocale, t } from '@app/lib/i18n';
import GlobeIcon from '@icon/system/regular/globe.svg';
import { Input } from '@ui';
import { createMemo, createSignal } from 'solid-js';
import { Virtualizer } from 'virtua/solid';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

function TimeZoneChoices() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const [search, setSearch] = createSignal('');
  const options = createMemo(() =>
    timezoneOptionsWithCurrent(
      timezoneOptions(undefined, formatLocale()),
      model.timeZone()
    )
  );
  const filtered = createMemo(() =>
    options().filter((option) =>
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
      <div class="h-[min(55dvh,22rem)] overflow-y-auto overscroll-contain scrollbar-hidden">
        <Virtualizer data={filtered()} itemSize={56}>
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
        </Virtualizer>
      </div>
    </>
  );
}

export function MobileComposerTimeZone() {
  const model = useCalendarComposer();
  const label = () => shortTimeZoneLabel(model.timeZone(), formatLocale());
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
