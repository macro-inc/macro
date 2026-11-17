import { dateTimeRangeValue } from '@app/components/date-time-range/time-range';
import { addMinutes, startOfHour } from 'date-fns';
import { defaultEditorInitialValues } from '../components/composer/event-form-model';

/** New-menu drafts start at the next half hour and last thirty minutes. */
export function defaultComposerValues(
  reference: Date,
  macroCallsEnabled: boolean
) {
  const minutesToBoundary = reference.getMinutes() < 30 ? 30 : 60;
  const start = addMinutes(startOfHour(reference), minutesToBoundary);
  return {
    ...defaultEditorInitialValues(reference, macroCallsEnabled),
    ...dateTimeRangeValue({ allDay: false, start, end: addMinutes(start, 30) }),
  };
}
