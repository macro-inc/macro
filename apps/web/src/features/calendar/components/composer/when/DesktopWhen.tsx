import { formatLocale, t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import ArrowIcon from '@icon/system/regular/arrow-right.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, ToggleSwitch } from '@ui';
import { batch, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { whenSummary } from '../../../core/when-summary';
import { useCalendarPreferences } from '../../../utils/preferences';
import { ComposerTimeZone } from '../parts/ComposerTimeZone';
import { ComposerRangeFeedback } from './ComposerRangeFeedback';
import { WhenMonth } from './WhenMonth';
import { WhenTime } from './WhenTime';

export function DesktopWhen() {
  const [preferences] = useCalendarPreferences();
  const model = useCalendarComposer(),
    when = useCalendarComposer().when;
  let content: HTMLDivElement | undefined;
  const open = () =>
    when.state.active === 'when' ||
    when.state.active === 'start-time' ||
    when.state.active === 'end-time';
  const summary = () =>
    whenSummary(
      model.state().start,
      model.state().end,
      model.state().allDay,
      model.range.timeFormat ?? '12-hour',
      formatLocale()
    );
  return (
    <>
      <div class="flex min-w-0 flex-wrap items-center gap-0.5">
        <Popover
          open={open()}
          onOpenChange={(value) => (value ? when.open('when') : when.close())}
          placement="bottom-start"
          gutter={4}
        >
          <Popover.Trigger
            as={Button}
            variant="value"
            size="sm"
            class="max-w-full whitespace-normal text-left font-normal"
            aria-label={t('calendar.when')}
            disabled={
              model.fieldIsDisabled('start') && model.fieldIsDisabled('end')
            }
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                when.open('when');
              }
            }}
          >
            {summary()}
          </Popover.Trigger>
          <Show when={open()}>
            <ScopedPortal scope="local">
              <Popover.Content
                ref={content}
                class="menu-surface z-action-menu flex w-[268px] max-h-[calc(100dvh-32px)] flex-col gap-2 overflow-y-auto rounded-xl p-2 outline-none"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  queueMicrotask(() =>
                    content
                      ?.querySelector<HTMLElement>(
                        '[role="gridcell"][tabindex="0"]'
                      )
                      ?.focus()
                  );
                }}
                onEscapeKeyDown={(event) => {
                  event.stopPropagation();
                }}
              >
                <Popover.Title class="sr-only">
                  {t('common.chooseDateRange')}
                </Popover.Title>
                <WhenMonth
                  weekStartsOn={preferences.weekStartsOn}
                  size="desktop"
                  value={
                    parseLocalDate(model.state().start.slice(0, 10)) ??
                    new Date()
                  }
                  end={parseLocalDate(model.state().end.slice(0, 10))}
                  range={model.state().allDay && !model.range.endDisabled}
                  disabled={model.range.startDisabled}
                  onChange={(start, end) => {
                    if (end)
                      when.range(formatLocalDate(start), formatLocalDate(end));
                    else when.chooseDate('start', start);
                  }}
                />
                <Show when={!model.state().allDay}>
                  <div class="flex items-center gap-1.5 px-1 pt-1">
                    <WhenTime endpoint="start" />
                    <ArrowIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                    <WhenTime endpoint="end" />
                  </div>
                </Show>
                <ToggleSwitch
                  class="flex h-8 w-full flex-row-reverse justify-between px-2"
                  size="compact"
                  label={t('calendar.allDay')}
                  labelClass="text-sm text-ink-muted"
                  checked={model.state().allDay}
                  disabled={model.fieldIsDisabled('allDay')}
                  onChange={(value) =>
                    batch(() => {
                      when.allDay(value);
                      when.open('when');
                    })
                  }
                />
              </Popover.Content>
            </ScopedPortal>
          </Show>
        </Popover>
        <ComposerTimeZone ghost />
      </div>
      <ComposerRangeFeedback />
    </>
  );
}
