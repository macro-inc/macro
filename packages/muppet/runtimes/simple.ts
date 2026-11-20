import { serve } from '../core/behavior.ts';
import { lifecycle } from '../core/hook.ts';
import type { Runtime } from '../core/runtime.ts';
import {
  agentState,
  type Options,
  oneAtATime,
  reportFailures,
  systemPromptFor,
  wakeAgent,
  wakeContext,
  wakeFromHandlers,
} from './pieces.ts';

/**
 * The simplest runtime: runs every handler in this process until its source
 * ends. When a handler calls `wake`, it wakes the agent in the behavior's
 * context, one wake at a time across all sources, with the request, a system
 * prompt of the framework's prompt followed by `systemPrompt`, and the event
 * the handler was handling, and gives the handler the reply. Before each wake
 * it fires `preWake` and appends what its handlers `add` to the system
 * prompt; after, it fires `postReply`, or `failed` if the agent threw or
 * reported a failure. When a handler throws it fires `failed` too, unless
 * the handler was on `failed` itself. The system prompt lists the
 * behavior's capabilities, and the agent uses them through code mode: scripts
 * type-checked and turned into modules by `load` run in this process, with
 * the behavior's context.
 */
export const simple = ({ systemPrompt, ...scripts }: Options): Runtime => ({
  run: async (behavior) => {
    const run = lifecycle();
    const state = agentState(behavior, scripts);
    const build = wakeContext({
      systemPrompt: systemPromptFor(state, systemPrompt),
      state,
    });
    const wake = oneAtATime(
      wakeAgent({ agent: behavior.decorations.agent, run })
    );
    await serve(behavior, run, {
      wakeFor: wakeFromHandlers({ run, build, wake }),
      accept: reportFailures(run),
    });
  },
});
