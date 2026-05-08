import type { DateValue } from '@core/util/date';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  isNewMessage as isNewMessagePure,
  type NewMessageCheckable,
} from './Channel/util';

export type ActivityTracker = {
  openedAt: Accessor<Date>;
  newMessagesDismissed: Accessor<boolean>;
  dismissNewMessages: () => void;
  isNewMessage: (message: NewMessageCheckable) => boolean;
};

type ActivityTrackerOptions = {
  lastViewedAt: Accessor<DateValue | undefined | null>;
  userId: Accessor<string | undefined>;
};

export function createActivityTracker(
  props: ActivityTrackerOptions
): ActivityTracker {
  const [newMessagesDismissed, setNewMessagesDismissed] =
    createSignal<boolean>(false);

  const openedChannelAt = createMemo<Date>((prev) => prev ?? new Date());

  // Freeze lastViewedAt at the value present when the channel was first opened.
  // This prevents a query refetch (triggered by the activity mutation on mount)
  // from resetting viewed_at to "now" and hiding all the new-message indicators.
  const frozenLastViewedAt = createMemo<DateValue | undefined | null>((prev) =>
    prev !== undefined ? prev : props.lastViewedAt()
  );

  const isNewMessage = (message: NewMessageCheckable) =>
    isNewMessagePure(message, {
      dismissed: newMessagesDismissed(),
      lastViewedAt: frozenLastViewedAt(),
      openedAt: openedChannelAt(),
      userId: props.userId(),
    });

  const dismissNewMessages = () => {
    setNewMessagesDismissed(true);
  };

  return {
    openedAt: openedChannelAt,
    isNewMessage,
    newMessagesDismissed,
    dismissNewMessages,
  };
}
