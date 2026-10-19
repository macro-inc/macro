import Trash from '@phosphor/trash.svg';
import { Button, DatePicker, Dialog } from '@ui';
import { Show } from 'solid-js';
import type { AvailabilityIssue } from '../core/availability';
import {
  formatAvailabilityDate,
  formatAvailabilityDateRanges,
} from '../core/availability-month';
import type { AvailabilityHourRange } from '../core/availability-selection';
import { AvailabilityHoursEditor } from './availability-hours-editor';
import { SelectInput } from './fields';

/** Edit complete date exceptions without expanding the calendar layout. */
export function AvailabilityExceptionDialog(props: {
  open: boolean;
  dates: string[];
  ranges?: AvailabilityHourRange[];
  issue?: AvailabilityIssue;
  disabled: boolean;
  locked: boolean;
  onSelectDate: (date: string) => void;
  onChange: (ranges: AvailabilityHourRange[]) => void;
  onApply: () => void;
  onCancel: () => void;
  onClear: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  let content: HTMLDivElement | undefined;
  const datePickerOpen = () =>
    !!content?.querySelector('[data-date-picker-content]');
  return (
    <Dialog
      open={props.open}
      contentRef={(element) => (content = element)}
      position="center"
      class="flex h-[min(44rem,calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-16px))] w-[32rem] max-h-[calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-16px)] flex-col overflow-clip rounded-2xl bg-panel p-3 sm:p-5 outline-none [container:availability-exception/size] [&>[data-drawer-scroll-body]]:overflow-clip [&>[data-drawer-scroll-body]>div]:flex [&>[data-drawer-scroll-body]>div]:min-h-0 [&>[data-drawer-scroll-body]>div]:flex-1"
      onOpenChange={(open) => {
        if (!open && !props.locked && !datePickerOpen()) props.onCancel();
      }}
      onEscapeKeyDown={(event) => {
        // Let the nested picker own Escape before dismissing the dialog.
        if (event.defaultPrevented || datePickerOpen()) return;
        event.preventDefault();
        props.onCancel();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
        <AvailabilityHoursEditor
          ranges={props.ranges}
          issue={props.issue}
          disabled={props.disabled}
          onChange={props.onChange}
          header={
            <>
              <header class="shrink-0">
                <Dialog.Title class="text-lg font-semibold text-ink">
                  {props.dates.length > 1
                    ? 'Edit date exceptions'
                    : 'Edit date exception'}
                </Dialog.Title>
                <Dialog.Description class="mt-1 text-sm text-ink-muted [@container_availability-exception_(height<24rem)]:sr-only">
                  Set different hours or time off without changing your weekly
                  hours.
                </Dialog.Description>
              </header>
              <div class="flex shrink-0 flex-col gap-5">
                <Show
                  when={props.dates.length === 1}
                  fallback={
                    <p class="text-sm font-medium text-ink">
                      {formatAvailabilityDateRanges(props.dates)}
                    </p>
                  }
                >
                  <DatePicker
                    aria-label="Exception date"
                    value={props.dates[0]}
                    required
                    disabled={props.locked}
                    onChange={props.onSelectDate}
                  />
                </Show>
                <Show when={props.dates.length > 1}>
                  <SelectInput
                    label="Dates to edit"
                    value="all"
                    options={[
                      {
                        value: 'all',
                        label: `All ${props.dates.length} selected dates`,
                      },
                      ...props.dates.map((date) => ({
                        value: date,
                        label: formatAvailabilityDate(date),
                      })),
                    ]}
                    disabled={props.locked}
                    onChange={(date) => {
                      if (date !== 'all') props.onSelectDate(date);
                    }}
                  />
                </Show>
              </div>
            </>
          }
        >
          <footer class="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge-muted pt-4 [@container_availability-exception_(height<24rem)]:pt-2">
            <Button
              variant="ghost"
              size="lg"
              aria-label="Clear selected hours"
              class="text-failure not-touch:not-disabled:hover:text-failure"
              tooltip="Leave these dates blank and non-bookable instead of using weekly hours"
              onClick={props.onClear}
            >
              <Trash class="size-4" />
              <span class="[@container_availability-exception_(height<24rem)]:hidden">
                Clear selected hours
              </span>
            </Button>
            <div class="ml-auto flex gap-2">
              <Button variant="ghost" size="lg" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button
                variant="cta"
                size="lg"
                aria-label={
                  props.dates.length > 1
                    ? `Apply to ${props.dates.length} dates`
                    : 'Apply exception'
                }
                disabled={!props.ranges}
                onClick={props.onApply}
              >
                <span class="[@container_availability-exception_(height<24rem)]:hidden">
                  {props.dates.length > 1
                    ? `Apply to ${props.dates.length} dates`
                    : 'Apply exception'}
                </span>
                <span class="hidden [@container_availability-exception_(height<24rem)]:inline">
                  Apply
                </span>
              </Button>
            </div>
          </footer>
        </AvailabilityHoursEditor>
      </div>
    </Dialog>
  );
}
