import { createMemo } from 'solid-js';
import { REMINDER_PRESET_MINUTES } from '../utils/event-reminders';

export interface ComposerReminderOptions {
  minutes: number[];
  canAdd: boolean;
  preservedCount: number;
  disabled?: boolean;
  onChange: (minutes: number[]) => void;
}

/** Keep preset editing and non-popup preservation shared across both layouts. */
export function createComposerReminders(options: ComposerReminderOptions) {
  const offsets = createMemo(() =>
    [...new Set([...REMINDER_PRESET_MINUTES, ...options.minutes])].sort(
      (a, b) => a - b
    )
  );
  return {
    offsets,
    replace: (index: number, value: string) => {
      if (options.disabled) return;
      const offset = offsets().find((offset) => String(offset) === value);
      if (offset === undefined) return;
      options.onChange(
        options.minutes.map((current, position) =>
          position === index ? offset : current
        )
      );
    },
    remove: (index: number) => {
      if (!options.disabled)
        options.onChange(
          options.minutes.filter((_, position) => position !== index)
        );
    },
    add: (offset: number) => {
      if (
        options.disabled ||
        !options.canAdd ||
        options.minutes.includes(offset)
      )
        return;
      options.onChange([...options.minutes, offset]);
    },
  };
}
