/**
 * The people area's working parts, made from its ports: showing a run the
 * people in front of it, and recording what an exchange showed about them.
 * Everything that touches a record, a model or the log goes through here.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { Log } from '../../context/log.ts';
import type { People } from '../../contracts.ts';
import {
  type Ask,
  applyProposal,
  appraisePrompt,
  type Outcome,
  parseProposal,
  reflect,
  type Said,
  shouldReflect,
} from './appraise.ts';
import { type Present, section, shown } from './card.ts';
import type { AuthorOf } from './macro.ts';
import type { Who } from './rules.ts';
import type { Person, Store } from './store.ts';
import { worthAppraising } from './transcript.ts';

export type Keeping = {
  readonly store: Store;
  readonly who: Who;
  readonly ask: Ask;
  readonly authorOf: AuthorOf;
  /** The "people here" section for a prompt, and a log line saying who the run was shown. Empty when nobody's a person. */
  readonly section: (
    people: readonly Present[],
    run: string
  ) => Promise<string>;
  /** Appraises what people said, records what holds up, and reflects on anyone it moved. */
  readonly appraise: (
    messages: readonly Said[],
    context: readonly Said[]
  ) => Promise<readonly Outcome[]>;
  /** Appraises a chat exchange, unless it's too slight to read. */
  readonly appraiseExchange: (exchange: {
    readonly channelId: string;
    readonly messages: readonly Said[];
  }) => Promise<readonly Outcome[]>;
};

export const keeping = ({
  store,
  who,
  ask,
  authorOf,
  recent,
  log,
  stream,
  clock,
}: {
  readonly store: Store;
  readonly who: Who;
  readonly ask: Ask;
  readonly authorOf: AuthorOf;
  /** The last lines of a conversation, oldest first: the appraiser's context. */
  readonly recent: (channelId: string) => Promise<readonly Said[]>;
  readonly log: Pick<Log, 'event'>;
  readonly stream: string;
  readonly clock: Pick<Clock, 'now'>;
}): Keeping => {
  const appraise: Keeping['appraise'] = async (messages, context) => {
    const outcomes = await applyProposal(
      parseProposal(await ask(appraisePrompt(messages, context, who.name))),
      messages,
      { store, who, now: clock.now() }
    );
    for (const outcome of outcomes) await log.event(stream, outcome);
    const moved = new Set(
      outcomes.filter(({ kept }) => kept).map((outcome) => outcome.who)
    );
    for (const id of moved) {
      const person = await store.load(id);
      if (person !== undefined && shouldReflect(person, clock.now()))
        await reflect(person, {
          ask,
          store,
          now: clock.now(),
          name: who.name,
        }).catch((error: unknown) =>
          log.event(stream, { reflect: id, error: String(error) })
        );
    }
    return outcomes;
  };
  return {
    store,
    who,
    ask,
    authorOf,
    appraise,
    section: async (people, run) => {
      const here = shown(people, who);
      const records = new Map<string, Person>();
      for (const { id } of here) {
        const person = await store.load(id);
        if (person !== undefined) records.set(id, person);
      }
      // The log says who a run was shown, never what.
      if (here.length > 0)
        await log.event(stream, { card: run, who: here.map(({ id }) => id) });
      return section(here, records, clock.now(), who);
    },
    appraiseExchange: async ({ channelId, messages }) => {
      if (!worthAppraising(messages)) return [];
      return appraise(messages, await recent(channelId));
    },
  };
};

/**
 * What other areas get. Neither function throws or holds anything up: a
 * broken record costs the card, never the reply, and a failed appraisal
 * costs a memory, never the conversation.
 */
export const peoplePort = (
  keeping: Pick<Keeping, 'section' | 'appraiseExchange'>,
  { log, stream }: { readonly log: Pick<Log, 'event'>; readonly stream: string }
): People => ({
  cards: (ids, purpose, options) =>
    keeping
      .section(
        ids.map((id) => ({
          id,
          scope: options?.alone === true ? 'private' : 'shared',
        })),
        purpose
      )
      .catch(async (error: unknown) => {
        await log.event(stream, { card: purpose, error: String(error) });
        return '';
      }),
  appraise: (exchange) => {
    void keeping.appraiseExchange(exchange).catch((error: unknown) =>
      log.event(stream, {
        appraise: exchange.channelId,
        error: String(error),
      })
    );
  },
});
