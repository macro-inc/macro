import type { DateValue } from '@core/util/date';
import type { ApiChannelMessage } from '@service-comms/client';
import { createMemo, createSignal, type Accessor } from 'solid-js';

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

  const isNewMessage = (message: ApiChannelMessage) => {
    if (newMessagesDismissed()) return false;

    const lastViewed = props.lastViewedAt();
    if (!lastViewed) return false;

    const openedAt = openedChannelAt();
    const createdAt = new Date(message.created_at);

    return (
      createdAt > new Date(lastViewed) &&
      createdAt < openedAt &&
      props.userId() !== message.sender_id
    );
  };

  const dismissNewMessages = () => {
    setNewMessagesDismissed(false);
  };

  return {
    openedAt: openedChannelAt,
    isNewMessage,
    newMessagesDismissed,
    dismissNewMessages,
  };
}
