/**
 * Turning a call's event log into what the appraiser reads, and skipping
 * batches with nothing in them. Pure.
 */
import { z } from 'zod';
import type { Said } from './appraise.ts';
import { isPerson, type Who } from './rules.ts';

/** One line of a call's event log: who was heard, or what the agent said. */
export const CallEvent = z.object({
  t: z.number(),
  type: z.string(),
  who: z.string().optional(),
  text: z.string().optional(),
});
export type CallEvent = z.infer<typeof CallEvent>;

const heardType = 'turn.heard';
const spokenType = 'brain.text';
const contextTurns = 12;
const worthCharacters = 20;

/**
 * A 1:1 call only. On a group call the room guesses who spoke (placing a call
 * won't trust it either), and a wrong name on a memory is worse than no memory.
 */
export const callSaid = (
  events: readonly CallEvent[],
  callId: string,
  at: string,
  who: Pick<Who, 'me' | 'name'>
):
  | { readonly messages: readonly Said[]; readonly context: readonly Said[] }
  | undefined => {
  const heard = events.flatMap((event) =>
    event.type === heardType &&
    event.text !== undefined &&
    event.text !== '' &&
    event.who !== undefined &&
    event.who !== ''
      ? [{ t: event.t, who: event.who, text: event.text }]
      : []
  );
  const [speaker, ...others] = new Set(heard.map((turn) => turn.who));
  if (others.length > 0 || !isPerson(speaker, who)) return undefined;
  return {
    messages: heard.map(({ t, text }) => ({
      id: `${callId}:${t}`,
      sender_id: speaker,
      from: speaker,
      at,
      text,
      dm: true,
    })),
    context: events
      .flatMap(({ type, t, text }) =>
        type === spokenType && text !== undefined && text !== ''
          ? [{ t, text }]
          : []
      )
      .slice(-contextTurns)
      .map(({ t, text }) => ({
        id: `${callId}:${t}`,
        sender_id: '',
        from: who.name,
        at,
        text,
        dm: true,
      })),
  };
};

/** "ok", "thanks", and reactions aren't worth a model call. */
export const worthAppraising = (
  messages: readonly Pick<Said, 'text'>[]
): boolean =>
  messages.reduce((sum, { text }) => sum + text.trim().length, 0) >=
  worthCharacters;
