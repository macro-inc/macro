import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { PhoneMonthEvent } from '../PhoneMonthEvent';

export function MonthDaySheet(props: {
  open: boolean;
  date: Date;
  events: CalendarEvent[];
  timeFormat: CalendarTimeFormat;
  onOpenChange: (open: boolean) => void;
  onOpenDay: () => void;
  onCreate: () => void;
  onSelect: (event: CalendarEvent, element: HTMLElement) => void;
  ref: (element: HTMLDivElement) => void;
}) {
  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      restoreFocus
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Day events"
          maxHeight={80}
          targetHeight={50}
          ref={props.ref}
        >
          <MobileDrawer.Handle class="pb-1" />
          <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-4">
            <Button
              variant="ghost"
              class="h-auto min-w-0 justify-start px-0 text-left text-xl font-semibold text-ink"
              onClick={props.onOpenDay}
              aria-label="Open day view"
            >
              {props.date.toLocaleDateString(formatLocale(), {
                weekday: 'short',
                month: 'long',
                day: 'numeric',
              })}
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              class="shrink-0"
              aria-label="Create event on selected day"
              onClick={props.onCreate}
            >
              <PlusIcon class="size-5" />
            </Button>
          </div>
          <MobileDrawer.ScrollBody class="gap-2 px-6">
            <For
              each={props.events}
              fallback={
                <p class="px-3 py-4 text-sm text-ink-muted">
                  {t('calendar.agendaNoEvents')}
                </p>
              }
            >
              {(event) => (
                <PhoneMonthEvent
                  event={event}
                  timeFormat={props.timeFormat}
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
