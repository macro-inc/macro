import { createContext, useContext } from 'solid-js';
import type { CustomRecurrenceModel } from '../primitives/create-custom-recurrence';

export const CustomRecurrenceContext = createContext<CustomRecurrenceModel>();

export function useCustomRecurrence() {
  const model = useContext(CustomRecurrenceContext);
  if (!model)
    throw new Error('Custom recurrence parts require CustomRecurrence');
  return model;
}
