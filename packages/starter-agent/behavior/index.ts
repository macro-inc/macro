/**
 * The agent's whole behavior: its context, where its events come from, what it
 * can do, and what happens when an event fires. Each area's context is made
 * once here, and its sources, capabilities and handlers are given it.
 */
import type { Agent } from '@macro-inc/muppet/core/agent';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Script as ScriptOf } from '@macro-inc/muppet/core/code';
import { fileStore, scheduling } from '@macro-inc/muppet/utilities/schedules';
import { callsContext } from './capabilities/calls/context.ts';
import { callsCapabilities } from './capabilities/calls/index.ts';
import { chatContext } from './capabilities/chat/context.ts';
import { chatCapabilities } from './capabilities/chat/index.ts';
import { heartbeatContext } from './capabilities/heartbeat/context.ts';
import { heartbeatCapabilities } from './capabilities/heartbeat/index.ts';
import { identityCapabilities } from './capabilities/identity/index.ts';
import { laterContext } from './capabilities/later/context.ts';
import { laterCapabilities } from './capabilities/later/index.ts';
import { peopleContext } from './capabilities/people/context.ts';
import { peopleCapabilities } from './capabilities/people/index.ts';
import { screenContext } from './capabilities/screen/context.ts';
import { secretsContext } from './capabilities/secrets/context.ts';
import { secretsCapabilities } from './capabilities/secrets/index.ts';
import { screenCapabilities } from './capabilities/screen/index.ts';
import { toolsContext } from './capabilities/tools/context.ts';
import { toolsCapabilities } from './capabilities/tools/index.ts';
import type { Base } from './context/index.ts';
import { callsHandlers } from './events/handlers/calls.ts';
import { secretsHandlers } from './events/handlers/secrets.ts';
import { chatHandlers } from './events/handlers/chat.ts';
import { failureHandlers } from './events/handlers/failures.ts';
import { heartbeatHandlers } from './events/handlers/heartbeat.ts';
import { identityHandlers } from './events/handlers/identity.ts';
import { laterHandlers } from './events/handlers/later.ts';
import { peopleHandlers } from './events/handlers/people.ts';
import { callsSources } from './events/sources/calls.ts';
import { chatSources } from './events/sources/chat.ts';

/** The owner of the schedules' state. */
const schedulesOwner = 'schedules';
const schedulesFile = 'schedules.json';

export const assistant = (
  base: Base,
  agent: Agent,
  /** Restarts the agent onto code that landed; none outside a supervisor. */
  restart?: () => Promise<void>
) => {
  const chat = chatContext(base);
  const chatEvents = chatSources(chat.decorations);
  const scheduled = scheduling({
    store: fileStore({
      file: base.join(base.state.memory(schedulesOwner), schedulesFile),
      files: base.files,
    }),
    clock: base.clock,
    tz: base.config.timeZone,
  });
  // Other areas hand the heartbeat their snapshot sections and prune rules here.
  const heartbeat = heartbeatContext(base, {
    sections: [],
    prune: [],
    restart,
  });
  // A task handed over from a reply or a call is a wake of its own, later.
  const later = laterContext(base, scheduled.decorations.schedules);
  const people = peopleContext(base, chat.decorations);
  const calls = callsContext(base, {
    chat: chat.decorations.chat,
    work: later.decorations.work,
    people: people.decorations.people,
  });
  const callsEvents = callsSources({ ...base, ...calls.decorations });
  const tools = toolsContext(base);
  const screen = screenContext(base);
  const secrets = secretsContext(base, scheduled.decorations.schedules);
  return behavior()
    .decorate(base)
    .decorate({ agent })
    .use(failureHandlers())
    .use(scheduled)
    .use(chat)
    .use(chatEvents)
    .use(chatCapabilities)
    .use(chatHandlers(chatEvents))
    .use(identityCapabilities)
    .use(identityHandlers())
    .use(later)
    .use(laterCapabilities)
    .use(laterHandlers(chatEvents))
    .use(people)
    .use(peopleCapabilities)
    .use(peopleHandlers())
    .use(heartbeat)
    .use(heartbeatCapabilities)
    .use(heartbeatHandlers(scheduled))
    .use(tools)
    .use(toolsCapabilities)
    .use(calls)
    .use(callsEvents)
    .use(callsCapabilities)
    .use(callsHandlers(callsEvents))
    .use(screen)
    .use(screenCapabilities)
    .use(secrets)
    .use(secretsCapabilities)
    .use(secretsHandlers(scheduled));
};

export type Assistant = ReturnType<typeof assistant>;

/** What a script's `main` is given: every script annotates it with this, so `context` is the agent's. */
export type Script = ScriptOf<ContextOf<Assistant>>;
