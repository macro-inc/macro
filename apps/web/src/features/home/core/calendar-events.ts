import { z } from 'zod';
import SAMPLE_CALENDAR from './calendar-events.json';

const calendarEventSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().positive(),
  title: z.string(),
  time: z.string(),
  location: z.string(),
  description: z.string(),
});

export const HOME_CALENDAR = z
  .object({
    date: z.iso.date(),
    events: z.array(calendarEventSchema),
  })
  .parse(SAMPLE_CALENDAR);

export type HomeCalendarEvent = z.infer<typeof calendarEventSchema>;
