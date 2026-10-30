import type { CalendarReplacementView } from '../../../generated/calendar/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** Durable organizer replacement, recoverable even after the original event is retired. */
export class CalendarReplacement {
  constructor(
    private readonly client: MacroClient,
    readonly id: string,
  ) {}

  /** Read progress without initiating provider writes. */
  async status(): Promise<CalendarReplacementView> {
    return unwrap(
      await this.client.calendar.calendarReplacementStatus({
        path: { operation_id: this.id },
      }),
    );
  }

  /** Confirm the reviewed cancellation and reinvitation, or resume that same operation.
   * Present the preview and obtain the organizer's confirmation before the first call. */
  async confirm(): Promise<CalendarReplacementView> {
    return unwrap(
      await this.client.calendar.confirmCalendarReplacement({
        path: { operation_id: this.id },
      }),
    );
  }

  /** Discard an unconfirmed preview. Confirmed operations must be recovered, not discarded. */
  async discard(): Promise<void> {
    unwrap(
      await this.client.calendar.discardCalendarReplacement({
        path: { operation_id: this.id },
      }),
    );
  }
}
