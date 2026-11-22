import { isMobile } from '@core/mobile/isMobile';
import { type ComponentProps, Show } from 'solid-js';
import { PhoneMonthBars } from './views/mobile/month-bars';

/** FullCalendar remains the shared range/data owner; phones overlay their month layout. */
export function CalendarMonth(props: ComponentProps<typeof PhoneMonthBars>) {
  return (
    <Show when={isMobile()}>
      <PhoneMonthBars {...props} />
    </Show>
  );
}
