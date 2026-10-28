import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import Calendar from '@icon/system/regular/calendar-blank.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, DatePicker, selectTriggerClasses } from '@ui';
import { createSignal, Show } from 'solid-js';
import { Field } from './fields';

export function BookingsDateRange(props: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  inline?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [from, setFrom] = createSignal(props.from);
  const [to, setTo] = createSignal(props.to);
  const [error, setError] = createSignal('');
  const format = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
  const reset = () => {
    setFrom(props.from);
    setTo(props.to);
    setError('');
  };
  const changeOpen = (next: boolean) => {
    if (next) reset();
    setOpen(next);
  };
  const form = () => (
    <form
      aria-label="Bookings date range"
      noValidate
      class="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const start = Date.parse(`${from()}T00:00:00Z`);
        const end = Date.parse(`${to()}T00:00:00Z`);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          setError('Choose a start and end date.');
          return;
        }
        if (start > end) {
          setError('End date must be on or after start date.');
          return;
        }
        props.onChange(from(), to());
        setError('');
        setOpen(false);
      }}
    >
      <Field label="From">
        <DatePicker
          aria-label="From"
          required
          value={from()}
          max={to() || undefined}
          onChange={setFrom}
        />
      </Field>
      <Field label="Through">
        <DatePicker
          aria-label="Through"
          required
          value={to()}
          min={from() || undefined}
          onChange={setTo}
        />
      </Field>
      <p class="text-xs text-ink-muted">Dates use your browser’s time zone.</p>
      <Show when={error()}>
        <p role="alert" class="text-xs text-failure">
          {error()}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
        <Show
          when={props.inline}
          fallback={
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          }
        >
          <MobileDrawer.Close
            as={Button}
            type="button"
            aria-label="Cancel"
            variant="ghost"
            size="md"
            onClick={reset}
          >
            Cancel
          </MobileDrawer.Close>
        </Show>
        <Button type="submit" variant="strong" size="md">
          Apply dates
        </Button>
      </div>
    </form>
  );
  return (
    <Show
      when={props.inline}
      fallback={
        <Popover
          open={open()}
          onOpenChange={changeOpen}
          placement="bottom-end"
          gutter={8}
          modal={false}
        >
          <Popover.Trigger
            type="button"
            aria-label="Bookings date range"
            class={selectTriggerClasses(
              'w-auto min-w-0 max-w-full text-sm font-normal touch:h-9'
            )}
          >
            <Calendar aria-hidden="true" class="size-4 shrink-0" />
            <span class="truncate">
              {format(props.from)} – {format(props.to)}
            </span>
            <CaretDown aria-hidden="true" class="size-3 shrink-0" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="menu-surface z-action-menu w-72 max-w-[min(var(--kb-popper-content-available-width),calc(100vw-1rem))] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto p-4 outline-none">
              <Popover.Title class="mb-4 text-sm font-medium">
                Bookings date range
              </Popover.Title>
              {form()}
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      }
    >
      <div class="px-4 py-3">{form()}</div>
    </Show>
  );
}
