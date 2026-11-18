import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import { parseLocalDate } from '@core/util/local-date';
import ClockIcon from '@icon/system/regular/clock.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import { ToggleSwitch } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { ComposerRecurrence } from '../../../components/composer/recurrence/ComposerRecurrence';
import { ComposerRangeFeedback } from '../../../components/composer/when/ComposerRangeFeedback';
import { WhenDate } from '../../../components/composer/when/WhenDate';
import { WhenMonth } from '../../../components/composer/when/WhenMonth';
import { WhenTime } from '../../../components/composer/when/WhenTime';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhen } from '../../../context/composer-when-context';
import { revealWhenPicker } from '../../../primitives/reveal-when-picker';

export function PhoneWhen(props: {
  scrollElement: Accessor<HTMLElement | undefined>;
}) {
  const model = useCalendarComposer(),
    when = useComposerWhen();
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
      const row = inlineStart() ? startRow : endRow,
        picker = inlineStart() ? startMount() : endMount();
      if (row && picker) revealWhenPicker(props.scrollElement(), row, picker);
    });
  };
  createEffect(on(() => when.state.active, reveal));
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const outside = (event: PointerEvent) => {
    if (
      group &&
      event.target instanceof Node &&
      !group.contains(event.target) &&
      (inlineStart() || inlineEnd())
    )
      when.close();
  };
  document.addEventListener('pointerdown', outside);
  onCleanup(() => document.removeEventListener('pointerdown', outside));
  return (
    <>
      <div ref={group} data-phone-when="">
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
                <Show when={!model.state().allDay}>
                  <WhenTime
                    endpoint="start"
                    inline
                    listMount={startMount()}
                    onReveal={reveal}
                  />
                </Show>
              </div>
            </SheetRow>
          </div>
          <Show when={inlineStart()}>
            <div ref={setStartMount} data-when-inline="start">
              <Show when={when.state.active === 'start-date'}>
                <div class="pb-2 pl-[42px] pr-3">
                  <WhenMonth
                    size="phone"
                    value={
                      parseLocalDate(model.state().start.slice(0, 10)) ??
                      new Date()
                    }
                    disabled={model.range.startDisabled}
                    onChange={(date) => {
                      when.chooseDate('start', date);
                      when.close();
                    }}
                  />
                </div>
              </Show>
            </div>
          </Show>
          <div ref={endRow}>
            <SheetRow>
              <div class="flex items-center gap-2">
                <WhenDate endpoint="end" />
                <Show when={!model.state().allDay}>
                  <WhenTime
                    endpoint="end"
                    inline
                    listMount={endMount()}
                    onReveal={reveal}
                  />
                </Show>
              </div>
            </SheetRow>
          </div>
          <Show when={inlineEnd()}>
            <div ref={setEndMount} data-when-inline="end">
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
            </div>
          </Show>
          <SheetRow icon={<RepeatIcon class="size-[18px]" />}>
            <ComposerRecurrence />
          </SheetRow>
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
