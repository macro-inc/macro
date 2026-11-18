import { isMobile } from '@core/mobile/isMobile';
import { type ComponentProps, Show } from 'solid-js';
import { PhoneMonth } from './components/PhoneMonth';

/** FullCalendar remains the shared range/data owner; phones overlay their month layout. */
export function CalendarMonth(props: ComponentProps<typeof PhoneMonth>) {
  return (
    <Show when={isMobile()}>
      <PhoneMonth {...props} />
    </Show>
  );
}
