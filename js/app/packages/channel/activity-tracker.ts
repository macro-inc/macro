import type { DateValue } from '@core/util/date';
import type { ApiChannelMessage } from '@service-comms/client';
import { createMemo, createSignal, type Accessor } from 'solid-js';
import { isNewMessage as isNewMessagePure } from './Channel/util';

type ActivityTracker = {
  openedAt: Accessor<Date>;
  newMessagesDismissed: Accessor<boolean>;
  dismissNewMessages: () => void;
  isNewMessage: (message: ApiChannelMessage) => boolean;
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

  const isNewMessage = (message: ApiChannelMessage) =>
    isNewMessagePure(message, {
      dismissed: newMessagesDismissed(),
      lastViewedAt: props.lastViewedAt(),
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
