import type { RosterAgent } from '@app/features/agents-view/core/roster';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';

/** What running a prompt block starts: a new agent session with the prompt as its first message. */
export type PromptRun = {
  prompt: string;
  /** Bot to run; omitted for Macro's default agent. */
  botId?: string;
};

/**
 * The app capabilities a prompt block reads. The production entry point
 * (`prompt-block-controls.tsx`) builds them; tests supply fakes.
 */
export type PromptBlockContext = {
  /** The signed-in account, so a run started by another never lands in this one. */
  accountId: Accessor<string | undefined>;
  /** Every agent and coder the viewer can see, as the new chat composer lists them. */
  roster: Accessor<RosterAgent[]>;
  /** The new chat composer's recent agent choices, newest first. */
  recentAgentIds: Accessor<string[]>;
  /** Whether the new chat composer offers Auto. */
  autoAvailable: Accessor<boolean>;
  /** Whether Auto sends `prompt` to a chat or a coding agent. */
  chooseMode: (prompt: string) => Promise<'chat' | 'code'>;
  /** Start the session and open it: a new split on desktop, full screen on a phone. */
  start: (run: PromptRun) => void;
};

const Context = createContext<PromptBlockContext>();

export function PromptBlockContextProvider(props: {
  value: PromptBlockContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}

export function usePromptBlockContext(): PromptBlockContext {
  const context = useContext(Context);
  if (!context)
    throw new Error('Prompt block controls need a PromptBlockContextProvider');
  return context;
}
