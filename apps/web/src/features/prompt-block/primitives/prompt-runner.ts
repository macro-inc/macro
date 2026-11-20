import {
  MACRO_PERSONA_ID,
  type RosterAgent,
} from '@app/features/agents-view/core/roster';
import { createMemo, createSignal } from 'solid-js';
import type { PromptBlockContext } from '../context/prompt-block-context';
import {
  AUTO_AGENT_CHOICE,
  autoCoder,
  macroAgent,
  runnableAgents,
} from '../core/prompt-agents';

/** Why a run did not start a session. */
export type PromptRunOutcome = 'started' | 'empty' | 'busy' | 'unavailable';

/**
 * The agent a prompt block runs with and the run itself. The choice starts
 * on Auto, as the new chat composer does, or on Macro where Auto is off.
 */
export function createPromptRunner(context: PromptBlockContext) {
  const [picked, setPicked] = createSignal<string>();
  const [running, setRunning] = createSignal(false);
  const agents = createMemo(() => runnableAgents(context.roster()));
  const autoChoice = () =>
    context.autoAvailable() ? AUTO_AGENT_CHOICE : MACRO_PERSONA_ID;
  const choice = () => {
    const id = picked();
    if (!id || id === AUTO_AGENT_CHOICE) return autoChoice();
    return id;
  };

  const agentFor = async (prompt: string): Promise<RosterAgent | undefined> => {
    const id = choice();
    if (id !== AUTO_AGENT_CHOICE)
      return agents().find((agent) => agent.id === id);
    const macro = macroAgent(agents());
    const coder = autoCoder(agents(), context.recentAgentIds());
    if (!coder) return macro;
    return (await context.chooseMode(prompt)) === 'code' ? coder : macro;
  };

  const run = async (prompt: string): Promise<PromptRunOutcome> => {
    const text = prompt.trim();
    if (!text) return 'empty';
    if (running()) return 'busy';
    const accountId = context.accountId();
    setRunning(true);
    try {
      const agent = await agentFor(text);
      if (context.accountId() !== accountId) return 'unavailable';
      if (!agent) return 'unavailable';
      context.start({ prompt: text, botId: agent.botId });
      return 'started';
    } finally {
      setRunning(false);
    }
  };

  return { agents, choice, choose: setPicked, running, run };
}

export type PromptRunner = ReturnType<typeof createPromptRunner>;
