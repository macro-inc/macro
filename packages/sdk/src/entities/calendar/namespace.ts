import type {
  CalendarAttendeeInputBody,
  ConferenceChange,
  CreateCalendarEventRequest,
  EventReminders,
  EventTime,
  EventTransparency,
  EventVisibility,
  OutOfOfficeProperties,
} from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Link } from '../email/link';
import { Calendar } from './calendar';
import { CalendarEvent } from './event';

/** Fields for a new calendar event. */
export interface CreateEventOptions {
  /** Display title. */
  title: string;
  /** Timed or all-day shape. */
  time: EventTime;
  /** Optional event body. */
  description?: string;
  /** Optional location label. */
  location?: string;
  /** Invited attendees. */
  attendees?: CalendarAttendeeInputBody[];
  /** Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). */
  recurrenceLines?: string[];
  /** Event visibility. */
  visibility?: EventVisibility;
  /** Availability behavior. */
  transparency?: EventTransparency;
  /** Reminder configuration; omit to keep the calendar defaults. */
  reminders?: EventReminders;
  /** Conference to attach; omit to create the event without one. */
  conference?: ConferenceChange;
  /** Out-of-office properties; present to create a Google out-of-office event. */
  outOfOffice?: OutOfOfficeProperties;
  /** Exact calendar to create the event on; takes precedence over the inbox
   * default. */
  calendar?: Calendar;
  /** Connected inbox whose primary calendar receives the event; defaults to the
   * requester's primary inbox. */
  emailLink?: Link;
}

/**
 * The calendar surface: the caller's visible calendars, event creation, and
 * handles to individual events and calendars. Backed by calendar_service (the
 * SDK reaches it on the gateway's `/calendar` route).
 */
export class CalendarNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The caller's visible calendars, primaries and writable first. */
  calendars(): Promise<Calendar[]> {
    return Calendar.list(this.client);
  }

  /** A handle to a calendar by id. Detail loads on first access. */
  calendar(id: string): Calendar {
    return Calendar.byId(this.client, id);
  }

  /** A handle to a calendar event by id, for driving mutations. */
  event(id: string): CalendarEvent {
    return CalendarEvent.byId(this.client, id);
  }

  /** Create a calendar event and return a handle to its synced record. */
  async createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
    const record = unwrap(
      await this.client.calendar.createCalendarEvent({
        body: toCreateBody(options),
      }),
    );
    return CalendarEvent.fromRecord(this.client, record);
  }
}

function toCreateBody(options: CreateEventOptions): CreateCalendarEventRequest {
  return {
    title: options.title,
    time: options.time,
    description: options.description,
    location: options.location,
    attendees: options.attendees,
    recurrenceLines: options.recurrenceLines,
    visibility: options.visibility,
    transparency: options.transparency,
    reminders: options.reminders,
    conference: options.conference,
    outOfOffice: options.outOfOffice,
    calendarId: options.calendar?.id,
    emailLinkId: options.emailLink?.id,
  };
}
