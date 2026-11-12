import type { NaturalTimeState } from '@core/natural-time/create-natural-time';
import { type Accessor, createMemo } from 'solid-js';
import type { ReminderTimeOption } from '../core/email-reminder';
import { readReminderPhrase } from '../core/reminder-phrase';
import { reminderQuickPresets } from '../reminder-schedule';

export type ReminderTimeChoices = {
  times: readonly ReminderTimeOption[];
  /** Why typed text offers no time of its own. */
  reason?: string;
};

/**
 * The typed time first, then the presets that match the text, one per
 * instant. Typed text is read by natural_time once it has loaded.
 */
export function createReminderTimeOptions(
  query: Accessor<string>,
  naturalTime: Accessor<NaturalTimeState>
) {
  return createMemo<ReminderTimeChoices>(() => {
    const search = query().trim();
    const now = new Date();
    const presets = reminderQuickPresets(now);
    if (!search) return { times: presets };

    const matching = presets.filter((preset) =>
      preset.label.toLowerCase().includes(search.toLowerCase())
    );
    const state = naturalTime();
    if (state.status === 'loading') return { times: matching };
    if (state.status === 'failed') {
      return {
        times: matching,
        reason: 'Typed times aren’t available right now. Choose one below.',
      };
    }

    const reading = readReminderPhrase(state.reader, search, now);
    if (reading.kind === 'unread') {
      return { times: matching, reason: reading.reason };
    }
    const seen = new Set(reading.options.map(({ date }) => date.getTime()));
    return {
      times: [
        ...reading.options,
        ...matching.filter(({ date }) => !seen.has(date.getTime())),
      ],
    };
  });
}
