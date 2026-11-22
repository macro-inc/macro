import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import ArrowIcon from '@icon/system/regular/arrow-right.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { ToggleSwitch } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ComposerRangeFeedback } from '../../../components/composer/when/ComposerRangeFeedback';
import { WhenDate } from '../../../components/composer/when/WhenDate';
import { WhenMonth } from '../../../components/composer/when/WhenMonth';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';
import { revealWhenPicker } from '../../../primitives/reveal-when-picker';
import { MobileComposerRecurrence } from './MobileComposerRecurrence';
import { MobileComposerTimeZone } from './MobileComposerTimeZone';
import { PhoneTimePill, PhoneTimeWheels } from './PhoneTime';

export function PhoneWhen(props: {
  scrollElement: Accessor<HTMLElement | undefined>;
}) {
  const model = useCalendarComposer(),
    when = useComposerWhen();
  const startId = createUniqueId(),
    endId = createUniqueId();
  const [startMount, setStartMount] = createSignal<HTMLDivElement>(),
    [endMount, setEndMount] = createSignal<HTMLDivElement>();
  let group: HTMLDivElement | undefined,
    startRow: HTMLDivElement | undefined,
    endRow: HTMLDivElement | undefined;
  const inlineStart = () =>
    when.state.active === 'start-date' || when.state.active === 'start-time';
  const inlineEnd = () =>
    when.state.active === 'end-date' || when.state.active === 'end-time';
  let frame: number | undefined;
  const reveal = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const row = inlineStart() || model.state().allDay ? startRow : endRow,
        picker = inlineStart() ? startMount() : endMount();
      if (row && picker) revealWhenPicker(props.scrollElement(), row, picker);
    });
  };
  createEffect(on(() => when.state.active, reveal));
  createEffect(() => {
    const active = when.state.active;
    if (active === 'start-time' && model.fieldIsDisabled('start')) when.close();
    if (active === 'end-time' && model.fieldIsDisabled('end')) when.close();
  });
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
          <div ref={startRow}>
            <SheetRow>
              <div class="flex items-center gap-2">
                <WhenDate endpoint="start" />
                <Show
                  when={
                    model.state().allDay &&
                    model.state().start.slice(0, 10) !==
                      model.state().end.slice(0, 10)
                  }
                >
                  <ArrowIcon class="size-4 shrink-0 text-ink-subtle" />
                  <WhenDate endpoint="end" />
                </Show>
                <Show when={!model.state().allDay}>
                  <PhoneTimePill endpoint="start" controls={startId} />
                </Show>
              </div>
            </SheetRow>
          </div>
          <Show when={inlineStart()}>
            <div ref={setStartMount} id={startId} data-when-inline="start">
              <Show when={when.state.active === 'start-date'}>
                <div class="pb-2 pl-[42px] pr-3">
                  <WhenMonth
                    size="phone"
                    value={
                      parseLocalDate(model.state().start.slice(0, 10)) ??
                      new Date()
                    }
                    end={parseLocalDate(model.state().end.slice(0, 10))}
                    range={model.state().allDay && !model.range.endDisabled}
                    disabled={model.range.startDisabled}
                    onChange={(date, end) => {
                      if (end)
                        when.range(formatLocalDate(date), formatLocalDate(end));
                      else when.chooseDate('start', date);
                      when.close();
                    }}
                  />
                </div>
              </Show>
              <Show
                when={
                  when.state.active === 'start-time' && !model.state().allDay
                }
              >
                <PhoneTimeWheels endpoint="start" />
              </Show>
            </div>
          </Show>
          <Show when={!model.state().allDay}>
            <div ref={endRow}>
              <SheetRow>
                <div class="flex items-center gap-2">
                  <WhenDate endpoint="end" />
                  <PhoneTimePill endpoint="end" controls={endId} />
                </div>
              </SheetRow>
            </div>
          </Show>
          <Show when={inlineEnd()}>
            <div ref={setEndMount} id={endId} data-when-inline="end">
              <Show when={when.state.active === 'end-date'}>
                <div class="pb-2 pl-[42px] pr-3">
                  <WhenMonth
                    size="phone"
                    value={
                      parseLocalDate(model.state().end.slice(0, 10)) ??
                      new Date()
                    }
                    minimum={parseLocalDate(model.state().start.slice(0, 10))}
                    disabled={model.range.endDisabled}
                    onChange={(date) => {
                      when.chooseDate('end', date);
                      when.close();
                    }}
                  />
                </div>
              </Show>
              <Show
                when={when.state.active === 'end-time' && !model.state().allDay}
              >
                <PhoneTimeWheels endpoint="end" />
              </Show>
            </div>
          </Show>
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
            class="px-3 text-[13px] text-ink-muted"
          >
            {reason()}
          </p>
        )}
      </Show>
      <ComposerRangeFeedback />
    </>
  );
}
