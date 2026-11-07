// config/events.json: which events wake the brain and how often it beats.
export type EventsConfig = {
  /** Event names streamed besides the ones the brain always needs. */
  events: string[];
  /** The Claude model every turn runs with. */
  model: string;
  /** The model a schedule's routine names; its run stops at once, so the cheapest will do. */
  scheduleModel: string;
  heartbeatMinutes: number;
  /** Wake on the heartbeat at least this often, even with an unchanged snapshot. */
  sweepHours: number;
  /** Kill a respond turn after this long. */
  respondTimeoutMinutes: number;
  /** Turns per tier allowed to run at once. */
  concurrency: Record<string, number> & {
    respond: number;
    heartbeat: number;
    work: number;
  };
};
export class EventsConfigError extends Error {}
const count = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new EventsConfigError(
      `config/events.json: ${name} must be a positive integer`
    );
  }
  return value;
};
export function parseEventsConfig(raw: unknown): EventsConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new EventsConfigError('config/events.json must be an object');
  }
  const value = raw as Record<string, unknown>;
  const events = value.events;
  if (
    !Array.isArray(events) ||
    !events.every((name) => typeof name === 'string')
  ) {
    throw new EventsConfigError(
      'config/events.json: events must be a list of event names'
    );
  }
  const concurrency = value.concurrency as Record<string, unknown> | undefined;
  if (typeof concurrency !== 'object' || concurrency === null) {
    throw new EventsConfigError(
      'config/events.json: concurrency must be an object'
    );
  }
  const name = (field: string): string => {
    const found = value[field];
    if (typeof found !== 'string' || found.trim() === '') {
      throw new EventsConfigError(
        `config/events.json: ${field} must name a model`
      );
    }
    return found;
  };
  return {
    events,
    model: name('model'),
    scheduleModel: name('scheduleModel'),
    heartbeatMinutes: count(value.heartbeatMinutes, 'heartbeatMinutes'),
    sweepHours: count(value.sweepHours, 'sweepHours'),
    respondTimeoutMinutes: count(
      value.respondTimeoutMinutes,
      'respondTimeoutMinutes'
    ),
    concurrency: {
      ...Object.fromEntries(
        Object.entries(concurrency).map(([tier, limit]) => [
          tier,
          count(limit, `concurrency.${tier}`),
        ])
      ),
      respond: count(concurrency.respond, 'concurrency.respond'),
      heartbeat: count(concurrency.heartbeat, 'concurrency.heartbeat'),
      work: count(concurrency.work, 'concurrency.work'),
    },
  };
}
