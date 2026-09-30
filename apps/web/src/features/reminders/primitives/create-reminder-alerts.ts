import {
  type Accessor,
  createEffect,
  createMemo,
  onCleanup,
  untrack,
} from 'solid-js';
import type { ReminderAlert } from '../core/reminder-alert';

/** One live alert that catches up on focus and survives notification refetches. */
export function createReminderAlerts(options: {
  items: Accessor<readonly ReminderAlert[]>;
  active: Accessor<boolean>;
  acknowledgedKeys: Accessor<readonly string[]>;
  prepareAcknowledge: (keys: string[]) => () => void;
  show: (
    items: Accessor<readonly ReminderAlert[]>,
    beginAcknowledge: () => () => void
  ) => () => void;
}): void {
  const pending = createMemo(() => {
    const acknowledged = new Set(options.acknowledgedKeys());
    return options.items().filter((item) => !acknowledged.has(item.key));
  });
  type LiveAlert = {
    hide: () => void;
    freeze: (items?: readonly ReminderAlert[]) => void;
  };
  let live: LiveAlert | undefined;

  const hide = (items?: readonly ReminderAlert[]) => {
    const previous = live;
    previous?.freeze(items);
    live = undefined;
    previous?.hide();
  };

  createEffect(() => {
    if (!options.active() || pending().length === 0) {
      hide();
      return;
    }
    if (live) return;
    let displayed = pending();
    let closing = false;
    const presentation = () => {
      if (!closing) {
        const next = pending();
        if (next.length > 0) displayed = next;
      }
      return displayed;
    };
    const current: LiveAlert = {
      hide: () => {},
      freeze: (items) => {
        // The closing toast stays mounted during its exit animation. Keep its
        // last nonempty contents independent of acknowledgement/new arrivals.
        displayed = [...(items ?? presentation())];
        closing = true;
      },
    };
    live = current;
    current.hide = untrack(() =>
      options.show(presentation, () => {
        // Capture intent while this toast is live, but persist only after the
        // requested navigation applies. A later arrival belongs to a new card.
        if (live !== current) return () => {};
        const opened = [...presentation()];
        const keys = opened.map((item) => item.key);
        const acknowledge = options.prepareAcknowledge(keys);
        let finished = false;
        return () => {
          if (finished) return;
          finished = true;
          // Blur, logout, or completion may retract this toast while native
          // navigation is pending. The user's already-applied open still counts.
          if (live === current) hide(opened);
          acknowledge();
        };
      })
    );
  });
  onCleanup(hide);
}
