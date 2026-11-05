// The calls the brain makes through @macro-inc/sdk: tasks and routines.
// A thin adapter behind the `Tasks` and `Routines` ports so the logic that
// uses them is tested without the network.
import { Macro } from '#macro-sdk';
import type { Hosts } from './config.ts';
import type { RoutineRecord, Routines, Trigger } from './schedules.ts';
import { tracedFetch } from './telemetry.ts';
import type { CreatedTask, Tasks } from './work.ts';
export function macroSdk(hosts: Hosts, apiKey: string): Macro {
  return new Macro({
    fetch: tracedFetch(fetch),
    auth: { type: 'user', apiKey },
    hosts: {
      storage: hosts.storage,
      properties: hosts.storage,
      search: hosts.storage,
      auth: hosts.auth,
      cognition: hosts.cognition,
      'agent-harness': hosts.agentHarness,
      'scheduled-action': hosts.scheduledAction,
    },
  });
}
/** Tasks the agent creates for itself: the SDK assigns a new task to its creator. */
export function sdkTasks(macro: Macro): Tasks {
  return {
    async create(name, markdown): Promise<CreatedTask> {
      const task = await macro.tasks.create({ name, markdown });
      return { id: task.id, url: task.webUrl() };
    },
  };
}
export function sdkRoutines(macro: Macro): Routines {
  return {
    async create({
      name,
      prompt,
      model,
      trigger,
    }: {
      name: string;
      prompt: string;
      model: string;
      trigger: Trigger;
    }): Promise<RoutineRecord> {
      const routine = await macro.routines.create({
        name,
        prompt,
        userPrompt: prompt,
        model,
        trigger,
        runVisibility: 'unlisted',
      });
      return { id: routine.id, name: await routine.name() };
    },
    async list(): Promise<RoutineRecord[]> {
      const routines = await macro.routines.list();
      return await Promise.all(
        routines.map(async (routine) => ({
          id: routine.id,
          name: await routine.name(),
        }))
      );
    },
    async delete(id) {
      await macro.routines.byId(id).delete();
    },
  };
}
