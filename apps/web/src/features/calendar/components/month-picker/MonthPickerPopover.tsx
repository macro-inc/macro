import { formatLocale, t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { MonthPicker } from './MonthPicker';
import { MonthPickerDateEntry } from './MonthPickerDateEntry';
import { MonthPickerGrid } from './MonthPickerGrid';
import { MonthPickerHeader } from './MonthPickerHeader';

export interface MonthPickerPopoverProps {
  date: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (date: Date) => void;
  focusDateEntry?: boolean;
}

/** Desktop placement of the shared month/year picker parts. */
export function MonthPickerPopover(props: MonthPickerPopoverProps) {
  let content: HTMLDivElement | undefined;
  const title = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      month: 'long',
      year: 'numeric',
    }).format(props.date);

  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
      gutter={8}
      flip
      slide
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="md"
        class="max-w-full min-w-0 justify-start"
        aria-label={t('calendar.chooseMonth')}
      >
        <span class="min-w-0 truncate text-[22px] font-semibold leading-7 text-ink">
          {title()}
        </span>
        <CaretDownIcon class="size-3 text-ink-muted" />
      </Popover.Trigger>
      {/* The focus scope must mount with real content, not a closed portal. */}
      <Show when={props.open}>
        <ScopedPortal scope="local">
          <Popover.Content
            ref={content}
            class="menu-surface z-action-menu w-[304px] max-w-[calc(100vw-1rem)] p-3"
            onOpenAutoFocus={(event) => {
              if (!props.focusDateEntry) return;
              event.preventDefault();
              content?.querySelector<HTMLInputElement>('input')?.focus();
            }}
          >
            <Popover.Title class="sr-only">
              {t('calendar.chooseMonth')}
            </Popover.Title>
            <MonthPicker date={props.date} onSelect={props.onSelect}>
              <MonthPickerHeader />
              <MonthPickerGrid selectedDate={props.date} />
              <MonthPickerDateEntry />
            </MonthPicker>
          </Popover.Content>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
