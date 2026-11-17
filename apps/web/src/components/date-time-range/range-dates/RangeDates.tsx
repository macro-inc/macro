import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { formatLocalDate } from '@core/util/local-date';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import { Popover } from '@kobalte/core/popover';
import { batch, createSignal, Show } from 'solid-js';
import { CalendarRange } from '../../ui/components/calendar-range/CalendarRange';
import { useDateTimeRange } from '../date-time-range-context';
import { createRangeDateSelection } from '../primitives/create-range-date-selection';
import { RangeDateTrigger } from './RangeDateTrigger';

/** Date pills for one range; both share a one-month, two-click range picker. */
export function RangeDates(props: { layout?: 'inline' | 'columns' }) {
  const range = useDateTimeRange();
  const columns = () => props.layout === 'columns';
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  let triggers: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  const picker = createRangeDateSelection({
    value: () => range,
    startDisabled: () => range.startDisabled ?? false,
    endDisabled: () => range.endDisabled ?? false,
    onChange: (value) =>
      batch(() => {
        if (value.start !== range.start) range.onStartChange(value.start);
        if (value.end !== range.end) range.onEndChange(value.end);
      }),
  });
  const open = () =>
    picker.state.open && !(range.startDisabled && range.endDisabled);
  const start = () =>
    open() && picker.state.draft.from
      ? formatLocalDate(picker.state.draft.from)
      : range.start.slice(0, 10);
  const end = () => {
    if (open() && picker.state.draft.from && !picker.state.draft.to) return '';
    return open() && picker.state.draft.to
      ? formatLocalDate(picker.state.draft.to)
      : range.end.slice(0, 10);
  };
  const choosingEnd = () => open() && picker.state.endpoint === 'end';
  const hasOnlyEndEditable = () => range.startDisabled && !range.endDisabled;
  const showEnd = () =>
    start() !== end() || choosingEnd() || hasOnlyEndEditable();
  const activate = (endpoint: 'start' | 'end', element: HTMLButtonElement) => {
    if (picker.open(endpoint)) setAnchor(element);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (!next) picker.close();
      }}
      anchorRef={anchor}
      placement="bottom-start"
      gutter={4}
    >
      <div
        ref={triggers}
        class={
          columns()
            ? 'grid grid-cols-[110px_24px_110px] items-center'
            : 'flex shrink-0 items-center gap-1'
        }
      >
        <RangeDateTrigger
          date={start()}
          fullWidth={columns()}
          label={t('common.editStartDate', { subject: range.subject })}
          placeholder={t('common.startDate')}
          active={open() && !choosingEnd()}
          disabled={range.startDisabled}
          invalid={range.invalid}
          describedBy={range.describedBy}
          onClick={(element) => activate('start', element)}
        />
        <Show when={showEnd()}>
          <ArrowRightIcon
            class="size-3 shrink-0 justify-self-center text-ink-extra-muted"
            aria-hidden="true"
          />
          <RangeDateTrigger
            date={end()}
            fullWidth={columns()}
            label={t('common.editEndDate', { subject: range.subject })}
            placeholder={t('common.endDate')}
            active={choosingEnd()}
            disabled={range.endDisabled}
            invalid={range.invalid}
            describedBy={range.describedBy}
            onClick={(element) => activate('end', element)}
          />
        </Show>
      </div>
      <Show when={open()}>
        <ScopedPortal scope="local">
          <Popover.Content
            ref={content}
            class="menu-surface z-action-menu w-72 max-w-[calc(100vw-2rem)] p-3 outline-none"
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
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              anchor()?.focus({ preventScroll: true });
            }}
            onInteractOutside={(event) => {
              if (
                event.detail.originalEvent.target instanceof Node &&
                triggers?.contains(event.detail.originalEvent.target)
              )
                event.preventDefault();
            }}
          >
            <Popover.Title class="sr-only">
              {t('common.chooseDateRange')}
            </Popover.Title>
            <CalendarRange
              required
              fixedWeeks
              value={picker.state.draft}
              onValueChange={picker.change}
              disabled={picker.dateIsDisabled}
            />
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
