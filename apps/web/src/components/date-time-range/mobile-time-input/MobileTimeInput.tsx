import { formatLocale, t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { onElementConnect } from '@core/util/onElementConnect';
import { Popover } from '@kobalte/core/popover';
import { Button, cn, Dropdown, Input } from '@ui';
import {
  type ComponentProps,
  createEffect,
  createMemo,
  createUniqueId,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { createTimeInput } from '../primitives/create-time-input';
import { editableClockValue } from '../primitives/mobile-clock-value';
import {
  observeTimeOptionViewport,
  revealTimeOption,
} from '../primitives/reveal-time-option';
import type { TimeInput } from '../time-input';
import {
  dayTimeOptions,
  selectedTimeOptionId,
  type TimeOption,
} from '../time-options';
import { TimeValue } from '../time-value/TimeValue';
import { MobileTimeOptions } from './MobileTimeOptions';

type MobileTimeInputProps = ComponentProps<typeof TimeInput> & {
  /** Anchor date for end-list headings after midnight. */
  date?: string;
};

/**
 * Phone clock input: first tap picks without a keyboard; the next tap types.
 * @do Pass end-time options and the anchor date for overnight ranges.
 * @dont Replace a selected option with its clock value alone; preserve its day offset.
 */
export function MobileTimeInput(props: MobileTimeInputProps) {
  const listId = createUniqueId();
  const periodId = `${listId}-period`;
  let anchor: HTMLSpanElement | undefined;
  let button: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let revealFrame: number | undefined;
  const options = createMemo(
    () => props.options ?? dayTimeOptions(props.timeFormat)
  );
  const selectedId = () =>
    props.selectedId ?? selectedTimeOptionId(props.value);
  const model = createTimeInput({
    options,
    selectedId,
    disabled: () => props.disabled ?? false,
    timeFormat: () => props.timeFormat,
    onChange: (option) => props.onChange(option),
  });
  const display = () =>
    editableClockValue(
      props.value,
      model.state.shown,
      model.state.navigated || model.state.typed !== undefined
        ? model.highlighted()?.value
        : undefined,
      props.timeFormat,
      formatLocale()
    );
  // Permission loss closes the native typing focus as well as the pending picker draft.
  createEffect(
    on(
      () => props.disabled,
      (disabled) => {
        if (!disabled) return;
        model.reset();
        if (document.activeElement === input) input?.blur();
      }
    )
  );
  const typing = () => model.state.mode === 'typing';
  const activeId = () => {
    const option = model.isOpen() ? model.highlighted() : undefined;
    return option ? `${listId}-${option.id.replace('|', '-')}` : undefined;
  };
  const reveal = (block: ScrollLogicalPosition) => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    revealFrame = requestAnimationFrame(() => {
      revealFrame = undefined;
      revealTimeOption(list, block === 'center');
    });
  };
  onCleanup(() => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
  });
  const focusValue = () => button?.focus({ preventScroll: true });
  const cancel = () => {
    model.reset();
    focusValue();
  };
  const choose = (option: TimeOption) => {
    model.choose(option);
    focusValue();
  };
  const openList = () => {
    model.openList();
    reveal('center');
  };
  const beginTyping = () => {
    model.beginTyping();
    // Both controls stay mounted so this focus stays inside the initiating touch gesture.
    input?.focus({ preventScroll: true });
    input?.select();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && model.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!model.isOpen()) openList();
      model.moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      reveal('nearest');
    } else if (event.key === 'Enter' && (typing() || model.state.navigated)) {
      event.preventDefault();
      event.stopPropagation();
      model.commit();
      focusValue();
    }
  };
  return (
    <Popover
      anchorRef={() => anchor}
      open={model.isOpen()}
      onOpenChange={(open) => {
        if (!open) model.commit();
      }}
      placement="bottom-start"
      gutter={4}
      flip={false}
      slide
    >
      <span
        ref={anchor}
        class={cn('inline-flex w-[110px] shrink-0', props.class)}
      >
        <span hidden={typing()} class="w-full">
          <Button
            ref={button}
            id={props.id}
            variant="value"
            size="field"
            fullWidth
            role="combobox"
            aria-label={props.label}
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-expanded={model.isOpen()}
            aria-activedescendant={activeId()}
            aria-invalid={props.invalid || undefined}
            aria-describedby={
              [props.describedBy, display().meridiem ? periodId : undefined]
                .filter(Boolean)
                .join(' ') || undefined
            }
            disabled={props.disabled}
            onClick={() => (model.isOpen() ? beginTyping() : openList())}
            onKeyDown={onKeyDown}
          >
            <TimeValue value={props.value} timeFormat={props.timeFormat} />
          </Button>
        </span>
        <span hidden={!typing()} class="relative w-full">
          <Input
            ref={input}
            id={`${props.id}-input`}
            type="text"
            role="combobox"
            aria-label={props.label}
            aria-autocomplete="both"
            aria-controls={listId}
            aria-expanded={model.isOpen()}
            aria-activedescendant={activeId()}
            aria-invalid={props.invalid || undefined}
            aria-describedby={
              [props.describedBy, display().meridiem ? periodId : undefined]
                .filter(Boolean)
                .join(' ') || undefined
            }
            disabled={props.disabled}
            autocomplete="off"
            spellcheck={false}
            placeholder={t('common.time')}
            size="field"
            variant="value"
            class="w-full pr-10"
            value={display().time}
            onInput={(event) => {
              const text = event.currentTarget.value;
              const filled = model.input(
                text,
                event.inputType.startsWith('insert')
              );
              event.currentTarget.value = display().time;
              if (model.highlighted()) reveal('center');
              if (filled)
                input?.setSelectionRange(
                  Math.min(text.length, display().time.length),
                  display().time.length
                );
            }}
            onBlur={model.commit}
            on:keydown={onKeyDown}
          />
          <Show when={display().meridiem}>
            <span
              id={periodId}
              class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-ink-muted"
            >
              {display().meridiem}
            </span>
          </Show>
        </span>
      </span>
      <Show when={model.isOpen()}>
        <ScopedPortal scope="local">
          <Popover.Content
            as={Dropdown.ContentFrame}
            class={cn(
              'max-h-[min(300px,var(--kb-popper-content-available-height))] max-w-[90vw] overflow-y-auto outline-none',
              props.date ? 'w-[196px]' : 'w-44'
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }}
            onInteractOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && anchor?.contains(target))
                event.preventDefault();
            }}
          >
            <Popover.Title class="sr-only">
              {t('common.chooseTime', { label: props.label })}
            </Popover.Title>
            <MobileTimeOptions
              ref={(element) => {
                list = element;
                onElementConnect(element, () =>
                  onCleanup(observeTimeOptionViewport(element))
                );
              }}
              id={listId}
              label={props.label}
              date={props.date}
              options={options()}
              selectedId={selectedId()}
              highlightedId={model.state.highlightedId}
              onChoose={choose}
            />
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
