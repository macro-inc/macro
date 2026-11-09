import {
  type EventStreamFilter,
  type EventStreamOptions,
  type StreamedEvent,
  streamEvents,
} from '@service-storage/event-stream';

export type { EventStreamFilter, EventStreamOptions, StreamedEvent };

/**
 * The viewer's live entity events for an HTML preview's `macro.on`. Not a
 * query: it is a long-lived stream with no cache, closed through `signal`.
 */
export function streamViewerEvents(options: EventStreamOptions): Promise<void> {
  return streamEvents(options);
}
