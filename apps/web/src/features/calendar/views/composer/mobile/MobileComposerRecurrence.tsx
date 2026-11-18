import { formatLocale, t } from '@app/lib/i18n';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import { Button, Input, RadioGroup } from '@ui';
import { batch, createSignal, For, Show } from 'solid-js';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { PhoneMenuPage } from '../../../components/composer/phone-menu/PhoneMenuPage';
import { WhenMonth } from '../../../components/composer/when/WhenMonth';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import { createCustomRecurrence } from '../../../primitives/create-custom-recurrence';
import {
  isValidRecurrenceConfig,
  recurrencePresetsFor,
  WEEKDAY_CODES,
} from '../../../utils/recurrence';

function CustomRepeatPage() {
  const composer = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const seed =
    recurrencePresetsFor(composer.controller.startForRecurrence()).find(
      (preset) => preset.id === composer.controller.recurrenceChoice()
    )?.config ?? composer.controller.customConfig();
  const [value, setValue] = createSignal(seed);
  const [dateOpen, setDateOpen] = createSignal(false);
  const model = createCustomRecurrence({
    get value() {
      return value();
    },
    get start() {
      return composer.controller.startForRecurrence();
    },
    get allDay() {
      return composer.state().allDay;
    },
    get disabled() {
      return composer.fieldIsDisabled('recurrence');
    },
    onChange: setValue,
  });
  const back = () => menus.when.open('repeat');
  const frequencies = () => [
    { value: 'DAILY', label: t('calendar.recurrenceDay') },
    { value: 'WEEKLY', label: t('calendar.recurrenceWeek') },
    { value: 'MONTHLY', label: t('calendar.recurrenceMonth') },
    { value: 'YEARLY', label: t('calendar.recurrenceYear') },
  ];
  const done = () => {
    if (model.input.disabled || !isValidRecurrenceConfig(value())) return;
    batch(() => {
      composer.controller.changeRecurrenceChoice('custom');
      composer.controller.setCustomConfig(value());
    });
    back();
  };
  return (
    <PhoneMenuPage
      title={t('calendar.customRepeat')}
      back={back}
      done={done}
      doneDisabled={model.input.disabled || !isValidRecurrenceConfig(value())}
    >
      <p class="text-sm text-ink-subtle">{model.description()}</p>
      <label class="flex min-h-11 items-center justify-between gap-3">
        <span>{t('calendar.repeatEvery')}</span>
        <Input
          variant="value"
          type="number"
          min="1"
          class="w-20"
          aria-label={t('calendar.repeatInterval')}
          value={value().interval}
          onInput={(event) => model.interval(event.currentTarget.valueAsNumber)}
        />
      </label>
      <For each={frequencies()}>
        {(frequency) => (
          <PhoneMenuChoice
            label={frequency.label}
            selected={value().frequency === frequency.value}
            onChoose={() => model.frequency(frequency.value)}
          />
        )}
      </For>
      <Show when={value().frequency === 'WEEKLY'}>
        <div class="grid grid-cols-7 gap-1">
          <For each={WEEKDAY_CODES}>
            {(day, index) => (
              <Button
                variant="value"
                size="sheet-row"
                class="px-0"
                aria-label={new Intl.DateTimeFormat(formatLocale(), {
                  weekday: 'long',
                }).format(new Date(2026, 10, 2 + index()))}
                aria-pressed={value().byDay.includes(day)}
                onClick={() => model.toggleDay(day)}
              >
                {new Intl.DateTimeFormat(formatLocale(), {
                  weekday: 'narrow',
                }).format(new Date(2026, 10, 2 + index()))}
              </Button>
            )}
          </For>
        </div>
      </Show>
      <RadioGroup
        aria-label={t('calendar.recurrenceEnds')}
        value={value().ends.kind}
        onChange={model.ends}
      >
        <For
          each={[
            { value: 'never', label: t('calendar.recurrenceNever') },
            { value: 'on', label: t('calendar.recurrenceOn') },
            { value: 'after', label: t('calendar.recurrenceAfter') },
          ]}
        >
          {(end) => (
            <RadioGroup.Item value={end.value} class="min-h-11">
              <RadioGroup.ItemControl />
              <RadioGroup.ItemLabel>{end.label}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup>
      <Show when={value().ends.kind === 'after'}>
        <Input
          variant="value"
          type="number"
          min="1"
          aria-label={t('calendar.recurrenceEndCount')}
          value={model.count()}
          onInput={(event) =>
            model.afterCount(event.currentTarget.valueAsNumber)
          }
        />
      </Show>
      <Show when={value().ends.kind === 'on'}>
        <Button
          variant="value"
          size="sheet-row"
          aria-label={t('calendar.recurrenceEndDate')}
          aria-expanded={dateOpen()}
          onClick={() => setDateOpen((open) => !open)}
        >
          {model.endDate()}
        </Button>
        <Show when={dateOpen()}>
          <WhenMonth
            size="phone"
            value={parseLocalDate(model.endDate()) ?? model.input.start}
            minimum={parseLocalDate(formatLocalDate(model.input.start))}
            onChange={(date) => {
              model.onDate(formatLocalDate(date));
              setDateOpen(false);
            }}
          />
        </Show>
      </Show>
    </PhoneMenuPage>
  );
}

export function MobileComposerRecurrence() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const disabled = () =>
    model.fieldIsDisabled('recurrence') ||
    Boolean(model.recurrenceScopeReason());
  return (
    <>
      <PhoneMenu
        menu="repeat"
        title={t('calendar.composerRepeats')}
        value={model.controller.selectedRecurrenceOption().label}
        icon={<RepeatIcon class="size-4" />}
        disabled={disabled()}
      >
        <For
          each={model.controller
            .recurrenceOptions()
            .filter((option) => option.value !== 'custom')}
        >
          {(option) => (
            <PhoneMenuChoice
              label={option.label}
              selected={model.controller.recurrenceChoice() === option.value}
              onChoose={() => {
                model.controller.changeRecurrenceChoice(option.value);
                menus.close();
              }}
            />
          )}
        </For>
        <PhoneMenuChoice
          label={t('calendar.customRepeat')}
          selected={model.controller.recurrenceChoice() === 'custom'}
          onChoose={() => menus.when.open('custom-repeat')}
        />
      </PhoneMenu>
      <Show when={menus.when.state.active === 'custom-repeat' && !disabled()}>
        <CustomRepeatPage />
      </Show>
    </>
  );
}
