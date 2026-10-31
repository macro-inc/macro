import type { CalendarEvent } from '@app/features/calendar/types';
import { eventDisplayTitle } from '@app/features/calendar/utils/event-forward-summary';
import { eventEmailRecipients } from '@app/features/calendar/utils/guest-emails';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { focusNewComposerTo } from './focus-new-composer';

/**
 * Opens a new email addressed to the event's other guests, with the event's
 * title as the subject, as Forward by email and Google Calendar's own
 * email-guests action fill it in. Desktop gets the composer in a split beside
 * the calendar; on touch devices `openWithSplit` never inserts a split, so the
 * composer takes over the screen instead.
 * `preserveParams` keeps the recipients on the history entry the same way
 * `mailto:` links do — the in-place replace path would otherwise drop them.
 */
export function useOpenEventEmail() {
  const { openWithSplit } = useSplitLayout();

  return (event: CalendarEvent) => {
    focusNewComposerTo();
    openWithSplit(
      {
        type: 'component',
        id: 'email-compose',
        params: {
          initialTo: eventEmailRecipients(event),
          initialSubject: eventDisplayTitle(event),
        },
        preserveParams: true,
      },
      // A composer already open holds another message; reusing it would
      // drop these recipients.
      { preferNewSplit: true, allowDuplicate: true }
    );
  };
}
