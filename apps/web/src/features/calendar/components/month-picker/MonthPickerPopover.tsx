import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { MonthYearPicker, type MonthYearPickerProps } from './MonthPicker';

export type MonthYearPickerPopoverProps = Omit<
  MonthYearPickerProps,
  'children' | 'onCancel' | 'initialFocus'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusGoToDate?: boolean;
  triggerSize: 'md' | 'sm';
  children: JSX.Element;
};

/** The same picker parts work here or directly in an inline host. */
export function MonthYearPickerPopover(props: MonthYearPickerPopoverProps) {
  const close = () => props.onOpenChange(false);
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
      gutter={8}
      flip
      slide
      modal
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size={props.triggerSize}
        class="max-w-full min-w-0 justify-start aria-expanded:bg-control"
        aria-label={t('calendar.chooseMonth')}
      >
        {props.children}
      </Popover.Trigger>
      <Show when={props.open}>
        <ScopedPortal scope="local">
          <Popover.Content
            class="menu-surface z-action-menu w-74 max-w-[calc(100vw-1rem)] p-3"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              {t('calendar.chooseMonth')}
            </Popover.Title>
            <MonthYearPicker
              value={props.value}
              today={props.today}
              initialFocus={props.focusGoToDate ? 'goToDate' : 'month'}
              showGoToDateHotkey={props.showGoToDateHotkey}
              onCancel={close}
              onChange={(date) => {
                close();
                props.onChange(date);
              }}
              onGoToDate={(date) => {
                close();
                props.onGoToDate?.(date);
              }}
            >
              <MonthYearPicker.Header />
              <MonthYearPicker.Grid />
              <MonthYearPicker.Footer />
            </MonthYearPicker>
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
