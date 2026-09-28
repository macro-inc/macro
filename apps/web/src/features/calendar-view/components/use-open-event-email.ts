import type { CalendarEvent } from '@app/features/calendar/types';
import { eventEmailRecipients } from '@app/features/calendar/utils/guest-emails';
import { EMAIL_COMPOSE_TO_INPUT_ID } from '@app/features/email-compose/core/constants';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { triggerFocusInput } from '@core/directive/focusInput';

/**
 * Opens a new email addressed to the event's other guests. Desktop gets the
 * composer in a split beside the calendar; on touch devices `openWithSplit`
 * never inserts a split, so the composer takes over the screen instead.
 * `preserveParams` keeps the recipients on the history entry the same way
 * `mailto:` links do — the in-place replace path would otherwise drop them.
 */
export function useOpenEventEmail() {
  const { openWithSplit } = useSplitLayout();

  return (event: CalendarEvent) => {
    // Focus the To field within this gesture so the iOS keyboard opens; the
    // composer mounts asynchronously, so this waits for the input.
    triggerFocusInput(() => document.getElementById(EMAIL_COMPOSE_TO_INPUT_ID));
    openWithSplit(
      {
        type: 'component',
        id: 'email-compose',
        params: { initialTo: eventEmailRecipients(event) },
        preserveParams: true,
      },
      { preferNewSplit: true }
    );
  };
}
