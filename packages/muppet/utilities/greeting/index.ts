/**
 * An agent's first hello to its owner, as a behavior to `use`: the moment the
 * agent runs, it greets its owner in their DM, once in its life. It says what
 * it has to work with and asks what it can help with.
 *
 * The words are a model's, from a prompt file the agent keeps (markdown):
 * its instructions, then one `## Have: <name>` section for each thing an
 * agent may have. Only the sections for what this agent has reach the model.
 * The call is one quick model call with no tools, not a wake, because the
 * owner has just added the agent and is watching the DM.
 *
 *     behavior().use(context).use(greeting((context) => greeterOf(context)))
 *
 * What the owner reads never names how the agent is built: a draft that
 * names a word in `unsayable` is written again once, then the greeting fails
 * without posting.
 */

import { behavior } from '../../core/behavior.ts';
import type { Catalog } from '../../core/capability.ts';
import { source } from '../../core/event.ts';
import type { Clock } from '../time/index.ts';

/** The heading that starts a section the model sees only when the agent has that thing. */
const havePrefix = '## Have: ';
const comment = /<!--[\s\S]*?-->/g;

/** The prompt's instructions, and what each thing the agent may have is, by name. */
export type GreetingPrompt = {
  readonly instructions: string;
  readonly haves: Readonly<Record<string, string>>;
};

/**
 * Splits a greeting prompt into its instructions and its `## Have: <name>`
 * sections. Comments are dropped.
 */
export const parseGreeting = (markdown: string): GreetingPrompt => {
  const [instructions = '', ...sections] = markdown
    .replace(comment, '')
    .split(new RegExp(`^${havePrefix}`, 'm'));
  const haves = Object.fromEntries(
    sections.map((section) => {
      const newline = section.indexOf('\n');
      const name = (
        newline === -1 ? section : section.slice(0, newline)
      ).trim();
      return [name, newline === -1 ? '' : section.slice(newline).trim()];
    })
  );
  return { instructions: instructions.trim(), haves };
};

/** What the model is asked: the instructions, then only what the agent has, then who is who. */
export const greetingRequest = (
  prompt: GreetingPrompt,
  facts: {
    readonly have: readonly string[];
    /** Undefined when the owner has no display name. */
    readonly ownerName: string | undefined;
    /** What the agent has written about who it is, if anything. */
    readonly identity: string | undefined;
  }
): string => {
  const haves = Object.entries(prompt.haves)
    .filter(([name]) => facts.have.includes(name))
    .map(([, text]) => `- ${text}`);
  const what =
    haves.length === 0
      ? 'Nothing to mention yet: say nothing about what you have.'
      : haves.join('\n');
  return [
    prompt.instructions,
    `## What you have\n\n${what}`,
    `## Your owner\n\n${facts.ownerName ?? 'Their name is unknown: greet them without one.'}`,
    `## Who you are\n\n${facts.identity ?? "You don't know yet: your owner hasn't told you."}`,
  ].join('\n\n');
};

/**
 * How any agent built on this library runs: never shown to its owner. An
 * agent's own tools (`codeTools` in `agents/code-tools.ts` for Claude Code)
 * go in `unsayable`'s `own`.
 */
const machinery = ['code mode', 'code-mode', 'capability script', 'muppet'];

/** A name with a capital inside it (`dmOwner`), so ordinary words (`react`) aren't banned. */
const camelCase = /^[a-z]+[A-Z]/;

/**
 * Words a greeting must never contain: the library's machinery, the agent's
 * own (its other tools' names, its command), and every catalog function
 * whose name is camelCase. A one-word name (`react`) is an ordinary word,
 * so it is left out.
 */
export const unsayable = (
  catalog: Catalog,
  own: readonly string[] = []
): readonly string[] => [
  ...machinery,
  ...own.filter((word) => word.trim() !== ''),
  ...Object.values(catalog).flatMap((capability) =>
    capability.kind === 'module'
      ? Object.keys(capability.functions).filter((name) => camelCase.test(name))
      : []
  ),
];

/** The unsayable words in `text`, if any. */
export const said = (text: string, words: readonly string[]): string[] => {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word.toLowerCase()));
};

export type GreetingSpan = {
  readonly set: (name: string, value: string | number | boolean) => void;
};

/** Runs `run` inside a span named `name`. */
export type GreetingTrace = <Value>(
  name: string,
  run: (span: GreetingSpan) => Promise<Value>
) => Promise<Value>;

/** A trace that records nothing. */
export const untraced: GreetingTrace = (_name, run) =>
  run({ set: () => undefined });

/** A model warming up for the greeting. */
export type GreetingModel = {
  /**
   * Asks it; called again, with the draft's problem, for a rewrite. Never
   * called after `cancel`. An answer pending when `cancel` is called
   * rejects (or is ignored): the greeting no longer waits for it.
   */
  readonly answer: (prompt: string) => Promise<string>;
  /** Drops it, whether or not it was asked: nothing more is wanted. Never throws. */
  readonly cancel: () => void;
};

/** What happened when the agent started. */
export type Greeted =
  | { readonly kind: 'already' }
  | { readonly kind: 'conversation_started' }
  | { readonly kind: 'gave_up'; readonly failures: Failures }
  | {
      readonly kind: 'posted';
      readonly channelId: string;
      readonly messageId: string;
      readonly text: string;
    };

/** The owner's DM, as the greeting uses it. */
export type GreetingChat = {
  /** The owner's display name; undefined when they have none. */
  readonly ownerName: () => Promise<string | undefined>;
  /** The id of the DM with the owner, opened if needed. */
  readonly ownerDm: () => Promise<string>;
  /**
   * Whether anyone has written in a channel yet. It must read fresh (the
   * primary, not a replica that lags), or a reply the owner just got goes
   * unseen and the hello lands after it.
   */
  readonly hasMessages: (channelId: string) => Promise<boolean>;
  /** Posts; it has its own transport timeout, since the greeting doesn't abandon a post. */
  readonly send: (
    channelId: string,
    text: string
  ) => Promise<{ readonly messageId: string }>;
  /**
   * Shows the agent typing, and returns a stop for this indicator only:
   * another indicator in the same channel (a reply's) keeps showing.
   * `typingIndicators` in `utilities/macro/chat` is one. It never throws and
   * never leaves a rejection unhandled; its stop also covers a start still
   * in flight. The greeting calls the stop once; a stop that rejects is
   * recorded on the span and otherwise ignored, since indicators expire.
   */
  readonly startTyping: (channelId: string) => () => Promise<void>;
};

/**
 * Where the greeting keeps what outlives a start. It assumes one agent
 * process at a time (the launcher runs one): two overlapping could both
 * greet before either marks it.
 */
export type GreetingStore = {
  /** Whether the agent has greeted, or is past greeting. */
  readonly greeted: () => Promise<boolean>;
  readonly markGreeted: () => Promise<void>;
  /**
   * Earlier starts, by kind, that asked the model (`paid`), or that gave up
   * before asking (`unpaid`). Every start that asks is counted as it asks,
   * before it knows whether it will finish, so one that dies mid-ask still
   * counts; one that then posts is counted too, and is marked greeted, so
   * its count no longer matters.
   */
  readonly failures: () => Promise<Failures>;
  readonly recordFailure: (kind: FailureKind) => Promise<void>;
};

/** Everything a greeting needs, as ports. */
export type Greeter = {
  /** The text of the greeting prompt. */
  readonly prompt: () => Promise<string>;
  /**
   * The names of what the agent has: its capabilities, and anything else the
   * prompt has a section for. Asked as the greeting is written, so an agent
   * can check that something is really there (turned on for its team, say).
   */
  readonly have: () => Promise<readonly string[]>;
  /** What the agent has written about who it is, if anything. */
  readonly identity: () => Promise<string | undefined>;
  /** Words the hello must never contain: see `unsayable`. */
  readonly unsayable: readonly string[];
  /**
   * A quick model with no tools, started as an attempt starts so it can
   * warm up (spawn, sign in) while the DM and the facts are fetched. Nothing
   * is asked, or paid for, until `answer`. It never throws: a model that
   * can't start fails its `answer`.
   */
  readonly model: () => GreetingModel;
  readonly chat: GreetingChat;
  readonly store: GreetingStore;
  readonly clock: GreetingClock;
  readonly trace: GreetingTrace;
};

/** Time, as the greeting needs it. */
export type GreetingClock = Pick<Clock, 'sleep'> & {
  /**
   * Calls `run` once after `ms`, unless the returned function is called
   * first: an attempt's deadline.
   */
  readonly after: (ms: number, run: () => void) => () => void;
  /** How long ago the agent's process started. */
  readonly sinceStartMs: () => number;
};

/** Whether a start had asked the model, which may have charged for it. */
export type FailureKind = 'paid' | 'unpaid';
export type Failures = Readonly<Record<FailureKind, number>>;

/**
 * A draft that names its machinery is written again once, told what it
 * said; a second one fails.
 */
const drafts = 2;
/**
 * Failed starts of each kind before the agent stops trying. A start that
 * asked the model may have paid for it, so few; one that never got that far
 * cost only its waits, so more.
 */
export const mostFailures: Failures = { paid: 3, unpaid: 10 };
/**
 * The waits before trying again within one start, after a failure before
 * the model was asked (Macro or the model unreachable for a moment): the
 * owner is watching the DM now, not at the next restart.
 */
export const retryDelaysMs: readonly number[] = [1_000, 5_000];
/**
 * The longest one attempt may take before it posts, all lanes and the model
 * together: a port that hangs must not leave the agent typing at its owner,
 * or the model running, for long. The post itself is never abandoned.
 */
export const attemptDeadlineMs = 90_000;

/** Runs `run` at most once; later calls get the first call's result. */
const onlyOnce = (run: () => Promise<void>): (() => Promise<void>) => {
  let ran: Promise<void> | undefined;
  return () => {
    ran ??= run();
    return ran;
  };
};

/**
 * Runs `run` until it succeeds once. A call while one is in flight waits for
 * that one; a rejection lets the next call try again.
 */
const untilDone = (run: () => Promise<void>): (() => Promise<void>) => {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= run().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
};

/** Thrown at an abandoned attempt's next step, so it stops without acting. */
const abandonedError = 'the greeting attempt ran past its deadline';

const write = async (
  model: GreetingModel,
  unsaid: readonly string[],
  request: string,
  span: GreetingSpan,
  steps: { readonly paid: () => Promise<void>; readonly live: () => void }
): Promise<string> => {
  let asked = request;
  for (let draft = 1; draft <= drafts; draft += 1) {
    span.set('agent.greeting.drafts', draft);
    steps.live();
    // Asked is paid: a call that fails, times out or is killed may still be
    // charged, so it is counted before it is made.
    await steps.paid();
    steps.live();
    const text = (await model.answer(asked)).trim();
    steps.live();
    if (text === '') throw new Error('the greeting came back empty');
    const named = said(text, unsaid);
    if (named.length === 0) return text;
    // Tool and function names: nothing personal, and what tells a false positive from a leak.
    span.set('agent.greeting.rejected_words', named.join(','));
    asked = [
      request,
      '## Your last draft',
      `It named how you are built, which your owner must never see: ${named.join(', ')}. Write it again without them.`,
    ].join('\n\n');
  }
  throw new Error('the greeting kept naming how the agent is built');
};

/** What an attempt holds that must be let go however it ends. */
type Held = {
  model: GreetingModel | undefined;
  stopTyping: () => Promise<void>;
  /** Set once the attempt has been given up on: it must not act any more. */
  abandoned: boolean;
};

/**
 * One try. Three lanes start together: the model warms up; the DM is opened,
 * the agent shows typing in it, and it is checked; the facts the request
 * needs are read. The model is asked only once both other lanes are done and
 * the DM is still empty, and is dropped if the owner wrote first. Just
 * before the post, `commit` takes the attempt off its deadline: a post in
 * flight is never abandoned.
 */
const attempt = async (
  greeter: Greeter,
  span: GreetingSpan,
  paid: () => Promise<void>,
  held: Held,
  commit: () => void
): Promise<Greeted> => {
  const { chat, store } = greeter;
  const live = (): void => {
    if (held.abandoned) throw new Error(abandonedError);
  };
  const model = greeter.model();
  held.model = model;
  const dmLane = () =>
    greeter.trace('agent.greeting.dm', async (dmSpan) => {
      const dm = await chat.ownerDm();
      live();
      span.set('agent.greeting.channel_id', dm);
      // The owner sees the agent typing as soon as the DM is known. The
      // stop is this indicator's own, so it never ends a reply's.
      const stop = chat.startTyping(dm);
      held.stopTyping = onlyOnce(async () => {
        try {
          await stop();
        } catch {
          span.set('agent.greeting.typing_stop_failed', true);
        }
      });
      const written = await chat.hasMessages(dm);
      dmSpan.set('agent.greeting.dm_written', written);
      return { dm, written };
    });
  const factsLane = () =>
    greeter.trace('agent.greeting.facts', () =>
      Promise.all([
        greeter.prompt(),
        chat.ownerName(),
        greeter.identity(),
        greeter.have(),
      ])
    );
  // Both lanes settle before either's failure is thrown, so typing can't
  // start after the cleanup has run.
  const [dmSettled, factsSettled] = await Promise.allSettled([
    dmLane(),
    factsLane(),
  ]);
  if (dmSettled.status === 'rejected') throw dmSettled.reason;
  live();
  const { dm, written } = dmSettled.value;
  // A deadline during the mark reports a failure though the marker may land;
  // the next start then reads it as greeted, and posts nothing.
  const standDown = async (): Promise<Greeted> => {
    live();
    span.set('agent.greeting.outcome', 'conversation_started');
    await store.markGreeted();
    return { kind: 'conversation_started' };
  };
  // A conversation that has started needs no facts: it is done either way.
  if (written) return await standDown();
  if (factsSettled.status === 'rejected') throw factsSettled.reason;
  const [prompt, ownerName, identity, have] = factsSettled.value;
  span.set('agent.greeting.have', have.join(','));
  span.set('agent.greeting.identity_known', identity !== undefined);
  span.set('agent.greeting.owner_named', ownerName !== undefined);
  const request = greetingRequest(parseGreeting(prompt), {
    have,
    ownerName,
    identity,
  });
  const text = await greeter.trace('agent.greeting.write', () =>
    write(model, greeter.unsayable, request, span, { paid, live })
  );
  live();
  await held.stopTyping();
  // The owner may have written while the words were being written.
  if (await chat.hasMessages(dm)) return await standDown();
  live();
  commit();
  const posted = await greeter.trace('agent.greeting.post', () =>
    chat.send(dm, text)
  );
  // Measured as the post lands, before the marker is written.
  span.set(
    'agent.greeting.since_start_ms',
    Math.round(greeter.clock.sinceStartMs())
  );
  span.set('agent.greeting.message_id', posted.messageId);
  span.set('agent.greeting.outcome', 'posted');
  await store.markGreeted();
  return { kind: 'posted', channelId: dm, messageId: posted.messageId, text };
};

/**
 * One attempt, in a span of its own, held to `attemptDeadlineMs` until it
 * commits to its post. However it ends (done, failed, or past its
 * deadline), its model is dropped and its typing stopped.
 */
const bounded = (
  greeter: Greeter,
  paid: () => Promise<void>,
  number: number
): Promise<Greeted> =>
  greeter.trace('agent.greeting.attempt', async (span) => {
    span.set('agent.greeting.attempt', number);
    const held: Held = {
      model: undefined,
      stopTyping: async () => {},
      abandoned: false,
    };
    let cancelDeadline: () => void = () => {};
    const deadline = new Promise<never>((_, reject) => {
      cancelDeadline = greeter.clock.after(attemptDeadlineMs, () => {
        held.abandoned = true;
        span.set('agent.greeting.timed_out', true);
        reject(new Error(abandonedError));
      });
    });
    // An abandoned attempt's own steps (a late model answer, a DM that opens
    // late) may still end after this span and its parent have: they then
    // throw at their next live() check, and act on nothing.
    // A deadline that is cancelled never settles: nothing waits on it then.
    deadline.catch(() => undefined);
    try {
      return await Promise.race([
        attempt(greeter, span, paid, held, () => cancelDeadline()),
        deadline,
      ]);
    } finally {
      cancelDeadline();
      held.model?.cancel();
      await held.stopTyping();
    }
  });

/**
 * Greets the owner once in the agent's life.
 *
 * A DM that already has a message in it (the owner wrote first, or a reply
 * answered them) is past the moment for a hello: the greeting is marked done
 * and nothing is posted. The DM is checked before the words are written and
 * again just before posting; a message that arrives between that last check
 * and the post still gets the hello after it, a window of one request.
 *
 * A start counts as paid the moment it asks the model. A failure before
 * that is tried again within the start, after `retryDelaysMs`, and counted
 * as unpaid if the start gives up; one after it is left to the next start.
 * At `mostFailures` of either kind the agent stops trying. Posting and
 * marking aren't one step: a crash between them leaves the DM non-empty, so
 * the next start marks it done instead of greeting again.
 */
export const greet = async (greeter: Greeter): Promise<Greeted> => {
  const { store } = greeter;
  return greeter.trace('agent.greeting', async (span) => {
    if (await store.greeted()) {
      span.set('agent.greeting.outcome', 'already');
      return { kind: 'already' };
    }
    const failures = await store.failures();
    span.set('agent.greeting.earlier_paid_failures', failures.paid);
    span.set('agent.greeting.earlier_unpaid_failures', failures.unpaid);
    if (
      failures.paid >= mostFailures.paid ||
      failures.unpaid >= mostFailures.unpaid
    ) {
      span.set('agent.greeting.outcome', 'gave_up');
      await store.markGreeted();
      return { kind: 'gave_up', failures };
    }
    // Counted once per start, as the model is first asked; a count that
    // couldn't be written is tried again before the next ask.
    const paid = untilDone(() => store.recordFailure('paid'));
    let asked = false;
    const ask = async (): Promise<void> => {
      await paid();
      asked = true;
    };
    try {
      for (let retry = 0; ; retry += 1) {
        try {
          const greeted = await bounded(greeter, ask, retry + 1);
          span.set('agent.greeting.outcome', greeted.kind);
          return greeted;
        } catch (error) {
          const delay = retryDelaysMs[retry];
          if (asked) throw error;
          if (delay === undefined) {
            // Counting must not hide why the start failed.
            try {
              await store.recordFailure('unpaid');
            } catch {
              span.set('agent.greeting.failure_not_recorded', true);
            }
            throw error;
          }
          span.set('agent.greeting.retries', retry + 1);
          await greeter.clock.sleep(delay);
        }
      }
    } catch (error) {
      span.set('agent.greeting.outcome', 'failed');
      throw error;
    } finally {
      // How long after start the greeting ended, posted or not.
      span.set(
        'agent.greeting.ended_since_start_ms',
        Math.round(greeter.clock.sinceStartMs())
      );
    }
  });
};

/** One event, when the agent starts running. */
const once = (): AsyncIterable<'started'> => ({
  async *[Symbol.asyncIterator]() {
    yield 'started';
  },
});

/** Runs a greeting inside something of the agent's: a trace's parent, say. */
export type Around = <Value>(run: () => Promise<Value>) => Promise<Value>;

const nothing: Around = (run) => run();

/** What an agent adds around its greeting. */
export type GreetingOptions<Context> = {
  /** Wraps the whole greeting, so its span can sit under the agent's own start span. */
  readonly around?: (context: Context) => Around;
  /**
   * Told how the greeting ended, e.g. to log it. A throw is a failed handler.
   * A posted greeting's `text` is what the owner was sent: log its kind and
   * ids, not its words.
   */
  readonly done?: (context: Context) => (greeted: Greeted) => Promise<void>;
};

/**
 * The greeting as a behavior: when the agent starts running, it greets its
 * owner, while its other sources start. A greeting that throws is a failed
 * handler, on `hooks.failed`.
 */
export const greeting = <Context extends object>(
  greeterOf: (context: Context) => Greeter,
  { around = () => nothing, done }: GreetingOptions<Context> = {}
) =>
  behavior<Context>()
    .source({ greeting: source(once()) })
    .on(
      (sources) => sources.greeting,
      async (_started, context) => {
        const greeted = await around(context)(() => greet(greeterOf(context)));
        await done?.(context)(greeted);
      }
    );
