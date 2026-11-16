import type { CodeMode } from './code.ts';

/** What the agent has to work with while it is awake. */
export type AgentState = {
  /** Its capabilities, used by writing and running code. */
  readonly code: CodeMode;
};

/** The event that led to a wake: the name of its source, e.g. "workMail" or "hooks.postReply", and its payload. */
export type EventContext = {
  readonly name: string;
  readonly payload: unknown;
};

/** Everything an agent is given when it is woken. */
export type WakeContext = {
  /** What the agent is asked to do. */
  readonly request: string;
  readonly systemPrompt: string;
  readonly event: EventContext;
  readonly state: AgentState;
};

export type Woke =
  | { readonly kind: 'done'; readonly reply: string }
  | { readonly kind: 'failed'; readonly error: string };

/** Something that can be woken to act, e.g. Claude Code. Anything implementing this can be an agent. */
export type Agent = {
  readonly wake: (wake: WakeContext) => Promise<Woke>;
};
