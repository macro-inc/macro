import type {
  BookingAttendance,
  BookingChange,
  Booking as BookingRecord,
  BookingSlot,
} from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/**
 * A meeting someone booked through one of the user's or their team's booking
 * links. Detail loads through the host's management view, so it needs the
 * personal owner, a host of the meeting or a team administrator.
 */
export class Booking extends MacroEntity<BookingRecord> {
  protected async fetch(): Promise<BookingRecord> {
    return unwrap(
      await this.client.calendar.getManagedBooking({ path: { id: this.id } }),
    ).booking;
  }

  /** A handle to a booking by id. Detail loads on first access. */
  static byId(client: MacroClient, id: string): Booking {
    return new Booking(client, id);
  }

  /** A handle seeded with a booking record the service returned. */
  static fromRecord(client: MacroClient, record: BookingRecord): Booking {
    return new Booking(client, record.id, record);
  }

  /** Meeting title, as it was when the meeting was booked. */
  readonly title = this.field('title');

  /** The guest's name. */
  readonly name = this.field('name');

  /** The guest's email. */
  readonly email = this.field('email');

  /** Absolute start. */
  readonly startsAt = this.field('startsAt');

  /** Absolute end. */
  readonly endsAt = this.field('endsAt');

  /** The guest's IANA display time zone. */
  readonly timeZone = this.field('timeZone');

  /** Lifecycle state. `failed` and `processing` need reconciliation, never a blind retry. */
  readonly status = this.field('status');

  /** Recorded attendance; `unknown` until a host records it. */
  readonly attendance = this.field('attendance');

  /** How many times the meeting moved to another start. */
  readonly rescheduleCount = this.field('rescheduleCount');

  /** When the meeting last moved, if it ever did. */
  readonly rescheduledAt = this.field('rescheduledAt');

  /** Final location or conference URL. */
  readonly location = this.field('location');

  /** The guest's answers, keyed by question id; {@link questionLabels} names each question. */
  readonly answers = this.field('answers');

  /** Question labels as they were when the meeting was booked, keyed by question id. */
  readonly questionLabels = this.field('questionLabels');

  /** The hosts assigned to the meeting. */
  readonly hosts = this.mappedField('hosts', (ids) =>
    ids.map((id) => User.byId(this.client, id)),
  );

  /**
   * Available replacement starts on one date (`YYYY-MM-DD`, in the booking
   * schedule's time zone), for {@link reschedule}. Availability is checked
   * again when the meeting moves.
   *
   * @readonly
   */
  async rescheduleSlots(date: string): Promise<BookingSlot[]> {
    return unwrap(
      await this.client.calendar.listBookingRescheduleSlots({
        path: { id: this.id },
        query: { date },
      }),
    ).slots;
  }

  /**
   * Move the meeting to a start returned by {@link rescheduleSlots}; only on
   * the user's go-ahead, since the guest and hosts are notified. Returns the
   * saved booking.
   *
   * @destructive
   * @openworld
   */
  async reschedule(startsAt: string): Promise<Booking> {
    return this.change({ action: 'reschedule', startsAt });
  }

  /**
   * Cancel the meeting; only on the user's go-ahead, since the guest and
   * hosts are notified. The booking link stays as it is. Returns the saved
   * booking.
   *
   * @destructive
   * @openworld
   * @idempotent
   */
  async cancel(): Promise<Booking> {
    return this.change({ action: 'cancel' });
  }

  /**
   * Approve a legacy pending booking and send its invitations; only on the
   * user's go-ahead. Returns the saved booking.
   *
   * @destructive
   * @openworld
   */
  async approve(): Promise<Booking> {
    return this.change({ action: 'approve' });
  }

  /**
   * Record or clear attendance once a confirmed meeting has ended. Returns
   * the saved booking.
   *
   * @write
   * @idempotent
   */
  async setAttendance(attendance: BookingAttendance): Promise<Booking> {
    return this.change({ action: 'attendance', attendance });
  }

  private async change(body: BookingChange): Promise<Booking> {
    const { booking } = await this.mutate((client) =>
      client.calendar.changeBooking({ path: { id: this.id }, body }),
    );
    return Booking.fromRecord(this.client, booking);
  }
}
