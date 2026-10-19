import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Button, DatePicker, Dropdown } from '@ui';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { insightPresetRange, insightRangeError } from '../core/insights';
import { Field } from './fields';

export function InsightsRangeSelector(props: {
  from: string;
  to: string;
  timeZone: string;
  now: Date;
  onChange: (from: string, to: string) => void;
  inline?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [customOpen, setCustomOpen] = createSignal(false);
  const [from, setFrom] = createSignal(props.from);
  const [to, setTo] = createSignal(props.to);
  const [error, setError] = createSignal('');
  const [startInput, setStartInput] = createSignal<HTMLButtonElement>();
  const selected = () =>
    [7, 30, 90].find((days) => {
      const range = insightPresetRange(days, props.timeZone, props.now);
      return range.from === props.from && range.to === props.to;
    });
  const changeCustomOpen = (next: boolean) => {
    if (next && !customOpen()) {
      setFrom(props.from);
      setTo(props.to);
      setError('');
    }
    setCustomOpen(next);
  };
  const close = () => {
    setCustomOpen(false);
    setOpen(false);
  };
  // Kobalte defers menu focus; focus the first date field after that tick.
  createEffect(() => {
    const input = startInput();
    if (!customOpen() || !input) return;
    let frame: number | undefined;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }, 0);
    onCleanup(() => {
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  const form = () => (
    <form
      aria-label="Custom insights date range"
      noValidate
      class="flex flex-col gap-3 p-3"
      onFocusIn={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (props.inline) return;
        // Keep calendar keys and nested dismissal out of the range menu.
        event.stopPropagation();
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !(
            event.target instanceof Element &&
            event.target.closest('[role="dialog"], [data-date-picker-content]')
          )
        ) {
          event.preventDefault();
          close();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const message = insightRangeError({ from: from(), to: to() });
        setError(message ?? '');
        if (message) return;
        close();
        props.onChange(from(), to());
      }}
    >
      <Field label="Start date">
        <DatePicker
          ref={setStartInput}
          aria-label="Start date"
          required
          value={from()}
          onChange={setFrom}
        />
      </Field>
      <Field label="End date">
        <DatePicker
          aria-label="End date"
          required
          min={from()}
          value={to()}
          onChange={setTo}
        />
      </Field>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure">
          {error()}
        </p>
      </Show>
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          class="flex-1"
          onClick={() => {
            setFrom('');
            setTo('');
            setError('');
          }}
        >
          Clear
        </Button>
        <Button type="submit" variant="cta" class="flex-1">
          Apply dates
        </Button>
      </div>
    </form>
  );
  return (
    <Show
      when={props.inline}
      fallback={
        <Dropdown
          open={open()}
          onOpenChange={(next) => {
            if (!next) setCustomOpen(false);
            setOpen(next);
          }}
          modal={false}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            size="md"
            aria-label="Insights date range"
            class="w-full justify-between px-2 text-left font-normal"
          >
            <span class="min-w-0 flex-1 truncate text-left">
              {selected() ? `Last ${selected()} days` : 'Custom range'}
            </span>
            <CaretDownIcon class="size-3 text-ink-extra-muted" />
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local" class="min-w-44">
            <Dropdown.Group>
              <Dropdown.RadioGroup
                value={selected()?.toString() ?? 'custom'}
                onChange={(value) => {
                  const range = insightPresetRange(
                    Number(value),
                    props.timeZone,
                    props.now
                  );
                  close();
                  props.onChange(range.from, range.to);
                }}
              >
                <For each={[7, 30, 90]}>
                  {(days) => (
                    <Dropdown.RadioItem value={days.toString()}>
                      <span class="flex-1">Last {days} days</span>
                      <Dropdown.ItemIndicator>
                        <CheckIcon class="size-3.5 text-accent" />
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                  )}
                </For>
                <Dropdown.Sub
                  open={customOpen()}
                  onOpenChange={changeCustomOpen}
                  overlap
                  slide
                  fitViewport
                >
                  <Dropdown.SubTrigger
                    // Keep the form open when leaving the trigger for a flipped submenu.
                    oncapture:pointerleave={(event: PointerEvent) => {
                      if (customOpen() && event.pointerType === 'mouse') {
                        event.stopImmediatePropagation();
                      }
                    }}
                    onPointerMove={(event) => {
                      if (customOpen()) event.preventDefault();
                    }}
                  >
                    <span class="flex-1">Custom range</span>
                    <Show when={!selected()}>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Show>
                    <CaretRightIcon class="size-3 text-ink-extra-muted" />
                  </Dropdown.SubTrigger>
                  <Dropdown.SubContent
                    portalScope="local"
                    class="w-72 max-w-[calc(100vw-1rem)] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto"
                  >
                    {form()}
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              </Dropdown.RadioGroup>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileFilterDrawer.Section
        value="date-range"
        label="Date range"
        activeCount={0}
      >
        <div role="radiogroup" aria-label="Date range">
          <For each={[7, 30, 90]}>
            {(days) => (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={selected() === days}
                onChange={() => {
                  const range = insightPresetRange(
                    days,
                    props.timeZone,
                    props.now
                  );
                  setFrom(range.from);
                  setTo(range.to);
                  setError('');
                  props.onChange(range.from, range.to);
                }}
              >
                Last {days} days
              </MobileFilterDrawer.Option>
            )}
          </For>
        </div>
        <div class="px-1 pb-2">
          <p class="px-3 pt-3 text-sm font-medium">Custom range</p>
          {form()}
        </div>
      </MobileFilterDrawer.Section>
    </Show>
  );
}
