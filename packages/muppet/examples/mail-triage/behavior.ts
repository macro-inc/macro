import { behavior, type ContextOf } from '../../core/behavior.ts';
import type { Script as ScriptOf } from '../../core/code.ts';
import { agent } from './agent.ts';
import { capabilities } from './capabilities.ts';
import { context } from './context.ts';
import { handlers } from './handlers.ts';
import { sources } from './sources.ts';

/** The agent's whole behavior. */
export const muppet = behavior()
  .use(context)
  .decorate({ agent })
  .use(sources)
  .use(capabilities)
  .use(handlers);

/** What a script's `main` is given: the type every script annotates it with. */
export type Script = ScriptOf<ContextOf<typeof muppet>>;
