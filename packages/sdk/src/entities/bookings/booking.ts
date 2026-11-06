import type {
  BookingAttendance,
  BookingChange,
  Booking as BookingRecord,
  BookingStatus,
  Slot,
} from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** A free time a booking can move to, from {@link Booking.rescheduleSlots}. */
export type BookingSlot = Slot;

/**
 * A meeting a guest booked through a booking link. Each handle is the booking
 * as it was read; every change returns the booking as saved.
 *
 * Cancelling, approving and rescheduling notify the guest and hosts. A
 * `failed` or `processing` status means a calendar write is still being
 * reconciled: read the bookings again later instead of repeating the change.
 */
export class Booking extends MacroEntity<BookingRecord> {
  private constructor(
    client: MacroClient,
    private readonly record: BookingRecord,
  ) {
    super(client, record.id, record);
  }

  /** Seed from a listed or changed booking. */
  static from(client: MacroClient, record: BookingRecord): Booking {
    return new Booking(client, record);
  }

  protected async fetch(): Promise<BookingRecord> {
    return this.record;
  }

  /** The meeting title when it was booked. */
  get title(): string {
    return this.record.title;
  }

  /** Lifecycle state. */
  get status(): BookingStatus {
    return this.record.status;
  }

  /** Recorded attendance; `unknown` until a host records it. */
  get attendance(): BookingAttendance {
    return this.record.attendance ?? 'unknown';
  }

  /** Meeting start, as an ISO 8601 timestamp. */
  get startsAt(): string {
    return this.record.startsAt;
  }

  /** Meeting end, as an ISO 8601 timestamp. */
  get endsAt(): string {
    return this.record.endsAt;
  }

  /** The guest's IANA time zone. */
  get timeZone(): string {
    return this.record.timeZone;
  }

  /** The guest's name. */
  get guestName(): string {
    return this.record.name;
  }

  /** The guest's email address. */
  get guestEmail(): string {
    return this.record.email;
  }

  /** The assigned hosts. */
  get hosts(): User[] {
    return this.record.hosts.map((id) => User.byId(this.client, id));
  }

  /** Where the meeting happens: a place, or a call or conference URL. */
  get location(): string {
    return this.record.location;
  }

  /** The guest's answers, each with the question as it was asked. */
  get answers(): { question: string; answer: string }[] {
    return Object.entries(this.record.answers).map(([id, answer]) => ({
      question: this.record.questionLabels?.[id] ?? '',
      answer,
    }));
  }

  /** How many times the meeting has moved to a different start. */
  get rescheduleCount(): number {
    return this.record.rescheduleCount ?? 0;
  }

  /** When the meeting last moved, as an ISO 8601 timestamp. */
  get rescheduledAt(): string | undefined {
    return this.record.rescheduledAt ?? undefined;
  }

  /** Cancel the meeting and notify the guest and hosts. */
  async cancel(): Promise<Booking> {
    return this.change({ action: 'cancel' });
  }

  /** Approve a booking held for host approval, sending its invitations. */
  async approve(): Promise<Booking> {
    return this.change({ action: 'approve' });
  }

  /**
   * Record who attended, or `unknown` to clear it. Only after a confirmed
   * meeting has ended, by an assigned host or a page administrator.
   */
  async recordAttendance(attendance: BookingAttendance): Promise<Booking> {
    return this.change({ action: 'attendance', attendance });
  }

  /**
   * Free times on `date` (YYYY-MM-DD, in the booking schedule's time zone)
   * that {@link Booking.reschedule} can move this meeting to.
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
   * Move the meeting to a slot from {@link Booking.rescheduleSlots} and notify
   * the guest and hosts. Availability is checked again when it moves.
   */
  async reschedule(slot: BookingSlot): Promise<Booking> {
    return this.change({ action: 'reschedule', startsAt: slot.startsAt });
  }

  private async change(change: BookingChange): Promise<Booking> {
    const { booking } = unwrap(
      await this.client.calendar.changeBooking({
        path: { id: this.id },
        body: change,
      }),
    );
    return Booking.from(this.client, booking);
  }
}
