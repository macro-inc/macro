import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Routine, type RoutineOptions, routineBody } from './routine';

/** Scheduled and event-triggered routines. */
export class RoutineNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy routine handle. */
  byId(id: string): Routine {
    return Routine.byId(this.client, id);
  }

  /** Create an agent routine. */
  async create(options: RoutineOptions): Promise<Routine> {
    return Routine.from(
      this.client,
      unwrap(
        await this.client.scheduledAction.createScheduledAction({
          body: { ...routineBody(options), enabled: options.enabled ?? true },
        }),
      ),
    );
  }

  /** List routines, optionally including event triggers. */
  async list(options?: { includeEvents?: boolean }): Promise<Routine[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActions({
        query: { include_events: options?.includeEvents },
      }),
    ).map((record) => Routine.from(this.client, record));
  }
}
