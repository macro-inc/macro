import { calendarDescriptionToEditorHtml } from '../utils/calendar-description';

/** Compare serialized editor output without normalizing an untouched provider value. */
export function createComposerDescription(
  initial: string,
  onChange: (value: string) => void
) {
  let loaded: string | undefined;
  return {
    initialHtml: calendarDescriptionToEditorHtml(initial),
    initialized: (value: string) => {
      loaded = value;
    },
    changed: (value: string) => onChange(value === loaded ? initial : value),
  };
}
