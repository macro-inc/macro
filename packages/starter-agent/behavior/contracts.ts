/**
 * What areas provide to each other through the context. An area that needs
 * one of these names it in its `behavior<Needs>()`; the area that owns it
 * decorates the context with it. Nothing else crosses between areas except
 * events, hooks, and capabilities called by name.
 */
import type { Entry } from './capabilities/chat/entry.ts';

/** Work handed to a later run of its own, which reports back where it was asked. */
export type WorkRequest = {
  /** The task, standing alone: what was asked, by whom, the facts, what done looks like. */
  readonly task: string;
  /** A few words naming the task. */
  readonly label: string;
  /** The conversation the run reports back in. */
  readonly channelId?: string;
  /** The thread in that conversation. Never in a DM. */
  readonly root?: string;
};

/** Provided by the later area as `work`. */
export type Work = {
  readonly start: (request: WorkRequest) => Promise<{ readonly id: string }>;
  /** Work handed over and not yet started, as text for a prompt. "None." if there is none. */
  readonly inFlight: () => Promise<string>;
};

/** Provided by the people area as `people`. */
export type People = {
  /** What the agent knows of these people (by Macro id), as text for a prompt. Empty if there is nothing. Never throws. */
  readonly cards: (
    ids: readonly string[],
    purpose: 'reply' | 'call',
    options?: {
      /** The conversation is the agent and that one person, alone (a DM, a 1:1 call). Only then is what they said in private shown. */
      readonly alone?: boolean;
    }
  ) => Promise<string>;
  /** Records what an exchange showed about the people in it. Returns at once; the work happens later. Never throws. */
  readonly appraise: (exchange: {
    readonly channelId: string;
    readonly messages: readonly Entry[];
  }) => void;
};
