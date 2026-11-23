import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';
import { CalendarSwatch } from '../../calendar-swatch/CalendarSwatch';
export function CalendarComposerIdentity() {
  const model = useCalendarComposer();
  return (
    <Show when={model.isEdit()}>
      <CalendarSwatch
        class="size-4 rounded-sm"
        color={
          model.controller.selectedCalendarOption()?.color ??
          DEFAULT_CALENDAR_SOURCE.color
        }
      />
    </Show>
  );
}
