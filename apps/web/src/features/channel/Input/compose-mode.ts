/**
 * The face the channel input is composing with. `message` is the plain
 * markdown editor; `task` and `event` swap in the task and calendar-event
 * composers. New input transforms (polls, reminders, ...) extend this enum
 * rather than adding more boolean mode flags.
 */
export type ChannelComposeMode = 'message' | 'task' | 'event';

const CHANNEL_COMPOSE_MODES: readonly ChannelComposeMode[] = [
  'message',
  'task',
  'event',
];

/** Narrows a persisted (and therefore untrusted) value back into a mode. */
export function coerceComposeMode(value: unknown): ChannelComposeMode {
  return CHANNEL_COMPOSE_MODES.includes(value as ChannelComposeMode)
    ? (value as ChannelComposeMode)
    : 'message';
}
