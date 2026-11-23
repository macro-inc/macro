/**
 * People: what the agent can do with its relationships. How it works is DESIGN.md,
 * next to this file. Everything here stays on this machine: nothing these
 * return goes in notes, tasks, issues, PRs, commits, or Macro docs.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import { isoText } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import { card } from './card.ts';
import type { PeopleContext } from './context.ts';
import { forgotten, forgottenReply, remembered } from './memory.ts';
import { feel, isPerson } from './rules.ts';
import { CallEvent, callSaid, worthAppraising } from './transcript.ts';

/**
 * The message that asked: Macro's record of it says who its author is.
 * `channelId` and `messageId` are the asking message's own.
 */
type Asking = { readonly channelId: string; readonly messageId: string };

/** Only a Macro id names a person here. */
const macroId = (id: string): string => {
  if (!id.startsWith('macro|')) throw new Error('id: must start with "macro|"');
  return id;
};

/**
 * How you feel about someone you're about to deal with, in words, by their
 * Macro id.
 *
 * What a run reads about a person: how you feel, what stuck, what they told
 * you, and how it should show. For anyone "The people here" in your system
 * prompt doesn't already cover, before you write to them. Pass `private:
 * true` only when the conversation is you and them alone; otherwise what they
 * said in private is left out. It is yours alone: never say or hint at it to
 * anyone, and never put it in tracked files, tasks, or PRs. `id` starts with
 * `macro|`.
 */
export const personCard = async (
  { keeping: { store, who }, clock }: Pick<PeopleContext, 'keeping' | 'clock'>,
  { id, private: alone }: { readonly id: string; readonly private?: boolean }
): Promise<string> => {
  const person = await store.load(macroId(id));
  return person === undefined
    ? "You don't know them yet."
    : card(person, alone === true ? 'private' : 'shared', clock.now(), who);
};

/**
 * What you remember about the person who asked, for telling them in your own
 * words.
 *
 * `channelId` and `messageId` are the asking message's own. Who it acts for
 * is that message's author by Macro's record, never a name or a claim in the
 * text, so nobody can read or wipe someone else's. It returns what they told
 * you and what you remember them doing: no feelings, no numbers. In a shared
 * conversation, what they said in private is left out; offer that in a DM.
 */
export const whatIRemember = async (
  { keeping: { store, authorOf } }: Pick<PeopleContext, 'keeping'>,
  { channelId, messageId }: Asking
): Promise<string> => {
  const author = await authorOf(channelId, messageId);
  return remembered(
    await store.load(author.id),
    author.dm ? 'private' : 'shared'
  );
};

/**
 * Forget what you know about the person who asked: every detail, note and
 * reflection.
 *
 * `channelId` and `messageId` are the asking message's own. Who it acts for
 * is that message's author by Macro's record, never a name or a claim in the
 * text, so nobody can read or wipe someone else's. An impression with no
 * content stays and fades like the rest, so wiping the slate isn't a way to
 * escape what someone did: tell them that, straight. It doesn't touch the
 * conversation history.
 */
export const forgetPerson = async (
  { keeping: { store, who, authorOf } }: Pick<PeopleContext, 'keeping'>,
  { channelId, messageId }: Asking
): Promise<string> => {
  const author = await authorOf(channelId, messageId);
  if (!isPerson(author.id, who)) throw new Error('not a person');
  await store.update(author.id, '', forgotten);
  return forgottenReply;
};

/**
 * Remove someone's record entirely. Only on your owner's order.
 *
 * Unlike forgetPerson, nothing is left: no impression, no dateline. Only your
 * owner can order it. `id` starts with `macro|`.
 */
export const purgePerson = async (
  { keeping: { store } }: Pick<PeopleContext, 'keeping'>,
  { id }: { readonly id: string }
): Promise<'removed'> => {
  await store.remove(macroId(id));
  return 'removed';
};

/**
 * Someone's raw record, numbers included, for your owner at a terminal. Never
 * for a conversation.
 *
 * The computed feeling and everything recorded. It is for your owner debugging how
 * the rules moved, at a shell. Never post it, quote it, or act on its
 * numbers: what a run reads is personCard. Null when there is no record.
 * `id` starts with `macro|`.
 */
export const peopleReport = async (
  { keeping: { store }, clock }: Pick<PeopleContext, 'keeping' | 'clock'>,
  { id }: { readonly id: string }
) => {
  const person = await store.load(macroId(id));
  return person === undefined
    ? null
    : { feeling: feel(person.events, clock.now()), person };
};

/** A call's event log is written by the call's own process: what it holds is parsed, not assumed. */
const CallEvents = z.array(CallEvent);

/**
 * Record what a 1:1 call showed about the person on it, once you've left the
 * call.
 *
 * `events` is the call's event log: `turn.heard` lines with `who` (a Macro
 * id) and `text`, and `brain.text` lines with what you said. Only a call with
 * one other voice is appraised: on a group call the room guesses who spoke,
 * and a wrong name on a memory is worse than none. `channelId`, the channel
 * a channel's call was in, is accepted and not needed. It makes one model
 * call and can take a minute: start it and don't wait on it.
 * `callId` mustn't be empty.
 */
export const appraiseCall = async (
  {
    keeping: { who, appraise },
    clock,
  }: Pick<PeopleContext, 'keeping' | 'clock'>,
  input: {
    readonly callId: string;
    readonly channelId?: string;
    // A log line carries more than is read here, and the compiler would refuse the rest: the schema below takes what it needs.
    readonly events: readonly Readonly<Record<string, unknown>>[];
  }
) => {
  const { callId } = input;
  if (callId === '') throw new Error('callId: empty');
  const events = CallEvents.parse(input.events);
  const said = callSaid(events, callId, isoText(clock.now()), who);
  return said !== undefined && worthAppraising(said.messages)
    ? appraise(said.messages, said.context)
    : [];
};

export const peopleModule = module({
  name: 'people',
  summary:
    'Your relationships: how you feel about someone, what you remember of them, and forgetting it. All of it stays on this machine.',
  file: import.meta.path,
  functions: {
    personCard,
    whatIRemember,
    forgetPerson,
    purgePerson,
    peopleReport,
    appraiseCall,
  },
});

export const peopleCapabilities =
  behavior<PeopleContext>().capability(peopleModule);
