import { splitLocalDateTime } from '@app/components/date-time-range/time-options';
import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/SheetGroup';
import { SheetRow } from '@components/app/mobile/SheetRow';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import ArrowIcon from '@icon/system/regular/arrow-right.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { ToggleSwitch } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ComposerRangeFeedback } from '../../../components/composer/when/ComposerRangeFeedback';
import { WhenDate } from '../../../components/composer/when/WhenDate';
import { WhenMonth } from '../../../components/composer/when/WhenMonth';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { revealWhenPicker } from '../../../primitives/reveal-when-picker';
import { useCalendarPreferences } from '../../../utils/preferences';
import { MobileComposerRecurrence } from './MobileComposerRecurrence';
import { MobileComposerTimeZone } from './MobileComposerTimeZone';
import { PhoneTimePill, PhoneTimeWheels } from './PhoneTime';

export function PhoneWhen(props: {
  scrollElement: Accessor<HTMLElement | undefined>;
}) {
  const [preferences] = useCalendarPreferences();
  const model = useCalendarComposer();
  const when = model.when;
  const startId = createUniqueId();
  const endId = createUniqueId();
  const [startMount, setStartMount] = createSignal<HTMLDivElement>();
  const [endMount, setEndMount] = createSignal<HTMLDivElement>();
  let group: HTMLDivElement | undefined;
  let startRow: HTMLDivElement | undefined;
  let endRow: HTMLDivElement | undefined;
  const datePart = (endpoint: 'start' | 'end') =>
    splitLocalDateTime(model.state()[endpoint]).date;
  const inlineStart = () =>
    !model.fieldIsDisabled('start') &&
    (when.state.active === 'start-date' || when.state.active === 'start-time');
  const inlineEnd = () =>
    !model.fieldIsDisabled('end') &&
    (when.state.active === 'end-date' || when.state.active === 'end-time');
  let frame: number | undefined;
  const reveal = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const row = inlineStart() || model.state().allDay ? startRow : endRow;
      const picker = inlineStart() ? startMount() : endMount();
      if (row && picker) revealWhenPicker(props.scrollElement(), row, picker);
    });
  };
  createEffect(on(() => when.state.active, reveal));
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const outside = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    const timeIsOpen =
      when.state.active === 'start-time' || when.state.active === 'end-time';
    const inTimeControl =
      group?.contains(event.target) &&
      event.target.closest(
        '[data-phone-time-control], [data-phone-time-wheels]'
      );
    if (timeIsOpen && !inTimeControl) when.close();
    else if (
      group &&
      !group.contains(event.target) &&
      (inlineStart() || inlineEnd())
    )
      when.close();
  };
  document.addEventListener('pointerdown', outside);
  onCleanup(() => document.removeEventListener('pointerdown', outside));
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!inlineStart() && !inlineEnd())) return;
    const endpoint = inlineStart() ? 'start' : 'end';
    const control = when.state.active?.endsWith('-date')
      ? 'data-composer-date'
      : 'data-phone-time-control';
    event.preventDefault();
    event.stopPropagation();
    when.close();
    group
      ?.querySelector<HTMLButtonElement>(`[${control}="${endpoint}"]`)
      ?.focus({ preventScroll: true });
  };
  return (
    <>
      <div ref={group} data-phone-when="" onKeyDown={closeOnEscape}>
        <SheetGroup>
          <SheetRow icon={<ClockIcon class="size-[18px]" />}>
            <ToggleSwitch
              size="lg"
              class="min-h-11 w-full flex-row-reverse justify-between"
              label={t('calendar.allDay')}
              labelClass="text-base text-ink"
              checked={model.state().allDay}
              disabled={model.fieldIsDisabled('allDay')}
              onChange={when.allDay}
            />
          </SheetRow>
          <For each={['start', 'end'] as const}>
            {(endpoint) => (
              <>
                <Show when={endpoint === 'start' || !model.state().allDay}>
                  <div
                    ref={(element) => {
                      if (endpoint === 'start') startRow = element;
                      else endRow = element;
                    }}
                  >
                    <SheetRow>
                      <div class="flex items-center gap-2">
                        <WhenDate endpoint={endpoint} />
                        <Show
                          when={
                            endpoint === 'start' &&
                            model.state().allDay &&
                            datePart('start') !== datePart('end')
                          }
                        >
                          <ArrowIcon class="size-4 shrink-0 text-ink-subtle" />
                          <WhenDate endpoint="end" />
                        </Show>
                        <Show when={!model.state().allDay}>
                          <PhoneTimePill
                            endpoint={endpoint}
                            controls={endpoint === 'start' ? startId : endId}
                          />
                        </Show>
                      </div>
                    </SheetRow>
                  </div>
                </Show>
                <Show when={endpoint === 'start' ? inlineStart() : inlineEnd()}>
                  <div
                    ref={endpoint === 'start' ? setStartMount : setEndMount}
                    id={endpoint === 'start' ? startId : endId}
                    data-when-inline={endpoint}
                  >
                    <Show when={when.state.active === `${endpoint}-date`}>
                      <div class="pb-2 pl-[42px] pr-3">
                        <WhenMonth
                          weekStartsOn={preferences.weekStartsOn}
                          size="phone"
                          value={
                            parseLocalDate(datePart(endpoint)) ?? new Date()
                          }
                          end={
                            endpoint === 'start'
                              ? parseLocalDate(datePart('end'))
                              : undefined
                          }
                          range={
                            endpoint === 'start' &&
                            model.state().allDay &&
                            !model.range.endDisabled
                          }
                          minimum={
                            endpoint === 'end'
                              ? parseLocalDate(datePart('start'))
                              : undefined
                          }
                          disabled={
                            endpoint === 'start'
                              ? model.range.startDisabled
                              : model.range.endDisabled
                          }
                          onChange={(date, end) => {
                            if (endpoint === 'start' && end)
                              when.range(
                                formatLocalDate(date),
                                formatLocalDate(end)
                              );
                            else when.chooseDate(endpoint, date);
                            when.close();
                          }}
                        />
                      </div>
                    </Show>
                    <Show
                      when={
                        when.state.active === `${endpoint}-time` &&
                        !model.state().allDay
                      }
                    >
                      <PhoneTimeWheels endpoint={endpoint} />
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </For>
          <Show when={!model.state().allDay}>
            <MobileComposerTimeZone />
          </Show>
          <MobileComposerRecurrence />
        </SheetGroup>
      </div>
      <Show when={model.recurrenceScopeReason()}>
        {(reason) => (
          <p
            id={model.ids.recurrenceReason}
            class="px-3 text-xs text-ink-muted"
          >
            {reason()}
          </p>
        )}
      </Show>
      <ComposerRangeFeedback />
    </>
  );
}
