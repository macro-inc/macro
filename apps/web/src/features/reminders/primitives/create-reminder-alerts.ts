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
  acknowledge: (keys: string[]) => void;
  show: (
    items: Accessor<readonly ReminderAlert[]>,
    acknowledge: () => void
  ) => () => void;
}): void {
  const pending = createMemo(() => {
    const acknowledged = new Set(options.acknowledgedKeys());
    return options.items().filter((item) => !acknowledged.has(item.key));
  });
  type LiveAlert = { hide: () => void };
  let live: LiveAlert | undefined;

  const hide = () => {
    const previous = live;
    live = undefined;
    previous?.hide();
  };

  createEffect(() => {
    if (!options.active() || pending().length === 0) {
      hide();
      return;
    }
    if (live) return;
    const current: LiveAlert = { hide: () => {} };
    live = current;
    current.hide = untrack(() =>
      options.show(pending, () => {
        // A teardown (blur, logout, completion) can finish after a new alert opens.
        if (live !== current) return;
        const keys = pending().map((item) => item.key);
        hide();
        options.acknowledge(keys);
      })
    );
  });
  onCleanup(hide);
}
