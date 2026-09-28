import type { VisibleCalendar } from '../../../generated/calendar/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Link } from '../email/link';
import { MacroEntity } from '../entity';

/**
 * A calendar visible to the requester across their connected inboxes: a
 * free-to-construct handle whose detail resolves from the caller's calendar
 * list. There is no fetch-by-id endpoint, so a bare {@link Calendar.byId}
 * handle loads its detail by listing the caller's calendars and matching on id.
 */
export class Calendar extends MacroEntity<VisibleCalendar> {
  protected async fetch(): Promise<VisibleCalendar> {
    const { calendars } = unwrap(await this.client.calendar.listCalendars());
    const found = calendars.find((calendar) => calendar.id === this.id);
    if (!found) throw new MacroNotFoundError(`calendar ${this.id} not found`);
    return found;
  }

  /** A handle to a calendar by id. Detail loads on first access. */
  static byId(client: MacroClient, id: string): Calendar {
    return new Calendar(client, id);
  }

  /** The caller's visible calendars, primaries and writable first. */
  static async list(client: MacroClient): Promise<Calendar[]> {
    const { calendars } = unwrap(await client.calendar.listCalendars());
    return calendars.map(
      (calendar) => new Calendar(client, calendar.id, calendar),
    );
  }

  /** Provider display name. */
  readonly name = this.field('name');

  /** Connected inbox address that syncs this calendar. */
  readonly emailAddress = this.field('emailAddress');

  /** Whether this is its account's primary calendar. */
  readonly isPrimary = this.field('isPrimary');

  /** Whether the grant can create and modify events on this calendar. */
  readonly isWritable = this.field('isWritable');

  /** Whether this is a subscribed system calendar (holidays, birthdays). */
  readonly isSubscription = this.field('isSubscription');

  /** Provider color, when set. */
  readonly color = this.field('color');

  /** A persistent per-calendar sync failure, surfaced for settings badges. */
  readonly syncError = this.field('syncError');

  /** The connected inbox (email link) that syncs this calendar. */
  readonly emailLink = this.mappedField('emailLinkId', (id) =>
    Link.byId(this.client, id),
  );
}
