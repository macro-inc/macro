import { createContext, useContext } from 'solid-js';
import type { EventFormState } from '../components/composer/event-form-state';

/** One form controller shared by all composer layouts and field parts. */
export const EventFormContext = createContext<EventFormState>();

export function useEventForm() {
  const form = useContext(EventFormContext);
  if (!form) throw new Error('EventFormParts must be rendered inside Root');
  return form;
}
