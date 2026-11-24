import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { ComposerOpenRequest } from '../core/composer-session';
import type { CalendarEvent } from '../types';
import type { CalendarComposerSession } from './create-calendar-composer-session';

/** Cards and editors share one sidebar slot and the editor's discard guard. */
export function createCalendarPanelState(options: {
  event: Accessor<CalendarEvent | undefined>;
  sessions: CalendarComposerSession;
  open: (request: ComposerOpenRequest) => Promise<number | undefined>;
}) {
  const [cardPinned, setPinned] = createSignal(false);
  let disposed = false;
  let pinRequest = 0;
  onCleanup(() => {
    disposed = true;
  });
  createEffect(
    on(
      () => options.event()?.id,
      (id) => {
        if (!id) setPinned(false);
      }
    )
  );

  const pinCard = async () => {
    const request = ++pinRequest;
    const id = options.event()?.id;
    if (!id || disposed) return false;
    const session = options.sessions.state.session;
    if (session && !(await options.sessions.close(session.key))) return false;
    // A discard dialog can outlive the card that requested the sidebar.
    if (
      disposed ||
      request !== pinRequest ||
      options.event()?.id !== id ||
      options.sessions.state.session
    )
      return false;
    setPinned(true);
    return true;
  };
  const setCardPinned = (pinned: boolean) => {
    if (!pinned) {
      pinRequest++;
      setPinned(false);
    } else fireAndForget(pinCard(), 'calendar-pin-event-card');
  };
  const open = async (request: ComposerOpenRequest) => {
    const pinAfterOpen = cardPinned() && Boolean(request.event);
    const requestVersion = pinRequest;
    const key = await options.open(request);
    if (
      key !== undefined &&
      pinAfterOpen &&
      !disposed &&
      pinRequest === requestVersion
    ) {
      options.sessions.setPinned(key, true);
      setPinned(false);
    }
    return key;
  };
  const leftPanelPinned = () => cardPinned() && Boolean(options.event());
  return { cardPinned, setCardPinned, leftPanelPinned, open };
}
