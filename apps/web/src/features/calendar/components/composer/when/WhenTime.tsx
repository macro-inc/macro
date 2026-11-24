import { createTimeInput } from '@app/components/date-time-range/create-time-input';
import { editableClockValue } from '@app/components/date-time-range/mobile-clock-value';
import { revealTimeOption } from '@app/components/date-time-range/reveal-time-option';
import {
  dayOffsetBetween,
  selectedTimeOptionId,
  splitLocalDateTime,
  type TimeOption,
} from '@app/components/date-time-range/time-options';
import { formatLocale, t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { Popover } from '@kobalte/core/popover';
import { cn, Input } from '@ui';
import { createEffect, createUniqueId, on, onCleanup, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { WhenTimeOptions } from './WhenTimeOptions';

export function WhenTime(props: {
  endpoint: 'start' | 'end';
  compact?: boolean;
}) {
  const composer = useCalendarComposer(),
    when = useCalendarComposer().when;
  const key = () => (props.endpoint === 'start' ? 'start-time' : 'end-time');
  const id = createUniqueId();
  let anchor: HTMLDivElement | undefined, input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined, frame: number | undefined;
  const value = () => splitLocalDateTime(composer.state()[props.endpoint]).time;
  const selectedId = () =>
    selectedTimeOptionId(
      value(),
      props.endpoint === 'end'
        ? dayOffsetBetween(composer.state().start, composer.state().end)
        : 0
    );
  const options = () => when.timeOptions(props.endpoint);
  const disabled = () => composer.fieldIsDisabled(props.endpoint);
  const model = createTimeInput({
    options,
    selectedId,
    disabled,
    onChange: (option) => when.chooseTime(props.endpoint, option),
  });
  const open = () => when.state.active === key() && model.isOpen();
  const display = () =>
    editableClockValue(
      value(),
      model.state.shown,
      model.state.typed !== undefined || model.state.navigated
        ? model.highlighted()?.value
        : undefined,
      composer.range.timeFormat,
      formatLocale()
    );
  const reveal = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      revealTimeOption(list, true, list);
    });
  };
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const activate = () => {
    when.open(key(), model.reset);
    model.beginTyping();
    reveal();
  };
  const closeTime = () => {
    if (when.state.active !== key()) return;
    when.open('when');
  };
  const commit = () => {
    model.commit();
    closeTime();
  };
  const choose = (option: TimeOption) => {
    model.choose(option);
    closeTime();
    input?.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      closeTime();
      input?.focus({ preventScroll: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!open()) activate();
      else model.moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      reveal();
    } else if (event.key === 'Enter' && open()) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  };
  createEffect(
    on(disabled, (locked) => {
      if (locked) {
        when.close(key());
        input?.blur();
      }
    })
  );
  const optionsView = () => (
    <WhenTimeOptions
      id={id}
      label={t(
        props.endpoint === 'start' ? 'calendar.startTime' : 'calendar.endTime'
      )}
      date={composer.state().start}
      options={options()}
      selectedId={selectedId()}
      highlightedId={model.state.highlightedId}
      onChoose={choose}
      ref={(element) => {
        list = element;
        reveal();
      }}
    />
  );
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (!next) commit();
      }}
      anchorRef={() => anchor}
      placement="bottom-start"
      gutter={4}
      flip={false}
      slide
    >
      <div
        ref={anchor}
        class={cn(
          'relative shrink-0 bg-control focus-within:inset-ring-[1.5px] focus-within:inset-ring-accent',
          'h-[30px] min-w-0 flex-1 rounded-lg text-sm',
          props.compact && 'h-8 w-24.5 flex-none'
        )}
      >
        <span class="relative block size-full">
          <Input
            ref={input}
            variant="bare"
            size="field"
            class="h-full w-full rounded-[inherit] pr-9 text-[inherit]"
            role="combobox"
            aria-label={t(
              props.endpoint === 'start'
                ? 'calendar.startTime'
                : 'calendar.endTime'
            )}
            aria-expanded={open()}
            aria-controls={id}
            aria-autocomplete="both"
            disabled={disabled()}
            value={display().time}
            onFocus={() => {
              if (!open()) activate();
              input?.select();
            }}
            onMouseDown={() => {
              if (!open() && document.activeElement === input) activate();
            }}
            onInput={(event) => {
              model.input(
                event.currentTarget.value,
                event.inputType.startsWith('insert')
              );
              event.currentTarget.value = display().time;
              reveal();
            }}
            onBlur={commit}
            on:keydown={keyDown}
          />
          <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-muted">
            {display().meridiem}
          </span>
        </span>
      </div>
      <Show when={open()}>
        <ScopedPortal scope="local">
          <Popover.Content
            class="menu-surface z-action-menu min-w-48 p-1 outline-none"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeTime();
            }}
          >
            {optionsView()}
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
