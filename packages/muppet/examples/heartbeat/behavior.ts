import { join } from 'node:path';
import { behavior, type ContextOf } from '../../core/behavior.ts';
import type { Script as ScriptOf } from '../../core/code.ts';
import { fileStore, scheduling } from '../../utilities/schedules/index.ts';
import { agent } from './agent.ts';
import { capabilities, recentNotes, writeNote } from './capabilities.ts';
import { clock, context, files, state, stop } from './context.ts';

/** The schedule that wakes the agent. */
export const heartbeat = 'heartbeat';

const schedulingName = 'scheduling';
const schedulesFile = 'schedules.json';

export const scheduled = scheduling({
  store: fileStore({
    file: join(state.capability(schedulingName), schedulesFile),
    files,
  }),
  clock,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  signal: stop.signal,
});

/** The agent's whole behavior. */
export const pulse = behavior()
  .use(context)
  .decorate({ agent })
  .use(scheduled)
  .use(capabilities)
  // Wakes the agent on every heartbeat.
  .on(
    (sources) => sources.schedules,
    async ({ name, due }, { wake }) => {
      if (name === heartbeat)
        await wake(
          `Heartbeat, due at ${due}. Check in, then leave a note for your next heartbeat.`
        );
    }
  )
  // Puts the last few notes in the system prompt, so a heartbeat never starts from nothing.
  .on(
    (sources) => sources.hooks.preWake,
    async ({ add }, context) => {
      const notes = await recentNotes(context, { count: 3 });
      add(
        notes.length === 0
          ? 'This is your first heartbeat.'
          : `## Your last notes\n\n${notes.map(({ at, text }) => `- ${at}: ${text}`).join('\n')}`
      );
    }
  )
  // Anything that fails still leaves a note, so the next heartbeat knows.
  .on(
    (sources) => sources.hooks.failed,
    async (failure, context) => {
      const what =
        failure.kind === 'wake'
          ? 'A heartbeat failed'
          : `A handler of ${failure.event.name} failed`;
      await writeNote(context, {
        text: `${what}: ${failure.error.split('\n')[0]}`,
      });
    }
  );

/** What a script's `main` is given: the type every script annotates it with. */
export type Script = ScriptOf<ContextOf<typeof pulse>>;
