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

import { codeTools } from '../../agents/claude-code.ts';
import { behavior } from '../../core/behavior.ts';
import type { Catalog } from '../../core/capability.ts';
import { source } from '../../core/event.ts';

/** The heading that starts a section the model sees only when the agent has that thing. */
const havePrefix = '## Have: ';
const comment = /<!--[\s\S]*?-->/g;

/** The prompt's instructions, and what each thing the agent may have is, by name. */
export type GreetingPrompt = {
  readonly instructions: string;
  readonly haves: Readonly<Record<string, string>>;
};

/** Splits a greeting prompt into its instructions and its `## Have: <name>` sections. Comments are dropped. */
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
  return [
    prompt.instructions,
    `## What you have\n\n${haves.join('\n')}`,
    `## Your owner\n\n${facts.ownerName ?? 'Their name is unknown: greet them without one.'}`,
    `## Who you are\n\n${facts.identity ?? "You don't know yet: your owner hasn't told you."}`,
  ].join('\n\n');
};

/** How an agent built on this library runs: never shown to its owner. */
const machinery = [
  codeTools.run,
  codeTools.describe,
  'code mode',
  'code-mode',
  'capability script',
  'muppet',
];

/** A name with a capital inside it (`dmOwner`), so ordinary words (`react`) aren't banned. */
const camelCase = /^[a-z]+[A-Z]/;

/**
 * Words a greeting must never contain: the library's machinery, the name of
 * every function in the catalog, and the agent's own (its other tools'
 * names, its command).
 */
export const unsayable = (
  catalog: Catalog,
  own: readonly string[] = []
): readonly string[] => [
  ...machinery,
  ...own,
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
  /** Asks it; called again, with the draft's problem, for a rewrite. */
  readonly answer: (prompt: string) => Promise<string>;
  /** Drops it, whether or not it was asked: nothing more is wanted. */
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
  readonly unsayable: readonly string[];
  /**
   * A quick model with no tools, started as the greeting starts so it can
   * warm up (spawn, sign in) while the DM and the facts are fetched. Nothing
   * is asked, or paid for, until `answer`.
   */
  readonly model: () => GreetingModel;
  /** The owner's display name; undefined when they have none. */
  readonly ownerName: () => Promise<string | undefined>;
  /** The id of the DM with the owner, opened if needed. */
  readonly ownerDm: () => Promise<string>;
  /** Whether anyone has written in a channel yet. */
  readonly hasMessages: (channelId: string) => Promise<boolean>;
  readonly send: (
    channelId: string,
    text: string
  ) => Promise<{ readonly messageId: string }>;
  /** Shows the agent typing; returns a stop for this indicator only. */
  readonly startTyping: (channelId: string) => () => Promise<void>;
  /** What the agent has written about who it is, if anything. */
  readonly identity: () => Promise<string | undefined>;
  /** Whether the agent has greeted, or is past greeting. */
  readonly greeted: () => Promise<boolean>;
  readonly markGreeted: () => Promise<void>;
  /** Earlier starts whose greeting failed: kept so a broken greeting doesn't spend, or wait, on every start. */
  readonly failures: () => Promise<Failures>;
  readonly recordFailure: (kind: FailureKind) => Promise<void>;
  /** Waits before trying again after a failure the model wasn't paid for. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly trace: GreetingTrace;
  /** How long ago the agent's process started. */
  readonly sinceStartMs: () => number;
};

/** Whether a failed start had asked the model, which may have charged for it. */
export type FailureKind = 'paid' | 'unpaid';
export type Failures = Readonly<Record<FailureKind, number>>;

/** A draft that names its machinery is written again once, told what it said; a second one fails. */
const attempts = 2;
/**
 * Failed starts of each kind before the agent stops trying. A start that
 * asked the model may have paid for it, so few; one that never got that far
 * cost only its waits, so more.
 */
export const mostFailures: Failures = { paid: 3, unpaid: 10 };
/**
 * The waits before trying again within one start, after a failure before
 * the model answered (Macro or the model unreachable for a moment): the
 * owner is watching the DM now, not at the next restart.
 */
export const retryDelaysMs: readonly number[] = [1_000, 5_000];

const write = async (
  model: GreetingModel,
  unsaid: readonly string[],
  request: string,
  span: GreetingSpan,
  paid: () => void
): Promise<string> => {
  let asked = request;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    span.set('agent.greeting.attempts', attempt);
    // Asked is paid: a call that fails or times out may still be charged.
    paid();
    const text = (await model.answer(asked)).trim();
    if (text === '') throw new Error('the greeting came back empty');
    const named = said(text, unsaid);
    if (named.length === 0) return text;
    // Tool and function names: nothing personal, and what tells a false positive from a leak.
    span.set('agent.greeting.rejected_words', named.join(','));
    asked = `${request}\n\n## Your last draft\n\nIt named how you are built, which your owner must never see: ${named.join(', ')}. Write it again without them.`;
  }
  throw new Error('the greeting kept naming how the agent is built');
};

/**
 * One try. Three lanes start together: the model warms up; the DM is opened,
 * the agent shows typing in it, and it is checked; the facts the request
 * needs are read. The model is asked only once both other lanes are done and
 * the DM is still empty, and is dropped if the owner wrote first. `paid` is
 * called as the model is asked.
 */
const attempt = async (
  greeter: Greeter,
  span: GreetingSpan,
  paid: () => void
): Promise<Greeted> => {
  const model = greeter.model();
  let stopTyping: () => Promise<void> = async () => {};
  try {
    const dmLane = async () => {
      const dm = await greeter.ownerDm();
      span.set('agent.greeting.channel_id', dm);
      // The owner sees the agent typing as soon as the DM is known. The stop
      // is this indicator's own, so it never ends a reply's.
      stopTyping = greeter.startTyping(dm);
      return { dm, written: await greeter.hasMessages(dm) };
    };
    const factsLane = () =>
      Promise.all([
        greeter.prompt(),
        greeter.ownerName(),
        greeter.identity(),
        greeter.have(),
      ]);
    // Both lanes settle before either's failure is thrown, so typing can't
    // start after the cleanup below has run.
    const [dmSettled, factsSettled] = await Promise.allSettled([
      dmLane(),
      factsLane(),
    ]);
    if (dmSettled.status === 'rejected') throw dmSettled.reason;
    if (factsSettled.status === 'rejected') throw factsSettled.reason;
    const { dm, written } = dmSettled.value;
    const [prompt, ownerName, identity, have] = factsSettled.value;
    const standDown = async (): Promise<Greeted> => {
      span.set('agent.greeting.outcome', 'conversation_started');
      await greeter.markGreeted();
      return { kind: 'conversation_started' };
    };
    if (written) return await standDown();
    span.set('agent.greeting.have', have.join(','));
    span.set('agent.greeting.identity_known', identity !== undefined);
    span.set('agent.greeting.owner_named', ownerName !== undefined);
    const request = greetingRequest(parseGreeting(prompt), {
      have,
      ownerName,
      identity,
    });
    const text = await greeter.trace('agent.greeting.write', () =>
      write(model, greeter.unsayable, request, span, paid)
    );
    await stopTyping();
    // The owner may have written while the words were being written.
    if (await greeter.hasMessages(dm)) return await standDown();
    const posted = await greeter.trace('agent.greeting.post', () =>
      greeter.send(dm, text)
    );
    // Measured as the post lands, before the marker is written.
    span.set(
      'agent.greeting.since_start_ms',
      Math.round(greeter.sinceStartMs())
    );
    span.set('agent.greeting.message_id', posted.messageId);
    span.set('agent.greeting.outcome', 'posted');
    await greeter.markGreeted();
    return { kind: 'posted', channelId: dm, messageId: posted.messageId, text };
  } finally {
    model.cancel();
    await stopTyping();
  }
};

/**
 * Greets the owner once in the agent's life.
 *
 * A DM that already has a message in it (the owner wrote first, or a reply
 * answered them) is past the moment for a hello: the greeting is marked done
 * and nothing is posted. The DM is checked before the words are written and
 * again just before posting; a message that arrives between that last check
 * and the post still gets the hello after it, a window of one request.
 *
 * A failure before the model was asked is tried again within the start,
 * after `retryDelaysMs`; one after it (the model may have charged) is left to
 * the next start. Each failed start is counted by kind, and at
 * `mostFailures` of either the agent stops trying. Posting and marking aren't one step: a crash between them leaves
 * the DM non-empty, so the next start marks it done instead of greeting
 * again.
 */
export const greet = async (greeter: Greeter): Promise<Greeted> => {
  if (await greeter.greeted()) return { kind: 'already' };
  return greeter.trace('agent.greeting', async (span) => {
    const failures = await greeter.failures();
    span.set('agent.greeting.earlier_paid_failures', failures.paid);
    span.set('agent.greeting.earlier_unpaid_failures', failures.unpaid);
    if (
      failures.paid >= mostFailures.paid ||
      failures.unpaid >= mostFailures.unpaid
    ) {
      span.set('agent.greeting.outcome', 'gave_up');
      await greeter.markGreeted();
      return { kind: 'gave_up', failures };
    }
    try {
      for (let retry = 0; ; retry += 1) {
        let wasPaid = false;
        try {
          return await attempt(greeter, span, () => {
            wasPaid = true;
          });
        } catch (error) {
          const delay = retryDelaysMs[retry];
          if (wasPaid || delay === undefined) {
            await greeter.recordFailure(wasPaid ? 'paid' : 'unpaid');
            throw error;
          }
          span.set('agent.greeting.retries', retry + 1);
          await greeter.sleep(delay);
        }
      }
    } catch (error) {
      span.set('agent.greeting.outcome', 'failed');
      throw error;
    } finally {
      // How long after start the attempt ended, posted or not.
      span.set(
        'agent.greeting.ended_since_start_ms',
        Math.round(greeter.sinceStartMs())
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
  /** Told how the greeting ended, e.g. to log it. A throw is a failed handler. */
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
