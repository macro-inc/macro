import { createContext, useContext } from 'solid-js';
import { z } from 'zod';

export const CALENDAR_VIEWPORT_KEY = 'calendar.viewport';

export const CalendarViewportSnapshotSchema = z.object({
  date: z.number().finite(),
  gridScrollTop: z.number().nonnegative().optional(),
  agenda: z
    .object({
      first: z.number().int(),
      date: z.number().finite(),
      top: z.number().finite(),
    })
    .optional(),
});
export type CalendarViewportSnapshot = z.infer<
  typeof CalendarViewportSnapshotSchema
>;

export interface CalendarViewportContext {
  initial: CalendarViewportSnapshot | undefined;
  register: (capture: () => CalendarViewportSnapshot) => () => void;
}

const Context = createContext<CalendarViewportContext>();
export const CalendarViewportProvider = Context.Provider;
export function useCalendarViewport() {
  const viewport = useContext(Context);
  if (!viewport)
    throw new Error('Calendar viewport requires CalendarViewportProvider');
  return viewport;
}
