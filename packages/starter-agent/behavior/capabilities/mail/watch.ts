/**
 * The watcher. Gmail history is the source of truth: a position and a list
 * of new ids, saved before anything acts on them, so a restart loses nothing
 * and a replay can't act twice.
 *
 * - New ids are saved as `pending` before anything acts on them.
 * - A decision is saved, as `acting`, before its action. On restart `acting`
 *   redoes the action, never the decision, so a crash exactly between the
 *   action finishing and the save could repeat it: one extra DM is better
 *   than a lost alert.
 * - `done` stops replays.
 * - If Gmail forgets the position (about a week down), a search refills it,
 *   deduped by `done`.
 * - A mail that can't be read or triaged after `maxAttempts` tries lands in
 *   the notes rather than vanish.
 */
import { z } from 'zod';
import { type Disk, readJson } from '../../context/disk.ts';
import { maxAttempts, rememberDoneDays, resyncQuery } from './config.ts';
import type { ReadOnlyMailbox } from './gmail.ts';
import { domainOf, type Mail, type RawMail } from './message.ts';
import { oneLine } from './redact.ts';
import { At, type Store } from './store.ts';
import { Decision } from './triage.ts';

export const WatchState = z.object({
  position: z.string(),
  /** Seen in history, not yet triaged. Value: failed attempts. */
  pending: z.record(z.string(), z.number()),
  /** Decided, action not known to be finished. */
  acting: z.record(z.string(), Decision),
  /** Done, with when: replayed history can't act twice. */
  done: z.record(z.string(), z.string()),
});
export type WatchState = z.infer<typeof WatchState>;

/**
 * A new mail, as the event that reaches the handler, and, when the agent is
 * woken, its prompt: facts checked by code and hashes of its links, never
 * its words.
 */
export const Arrival = z.object({
  kind: z.literal('mail'),
  id: z.string(),
  threadId: z.string(),
  domain: z.string(),
  authenticated: z.boolean(),
  colleague: z.boolean(),
  /** Hashes of the mail's links, which the wake guard keeps shut. */
  links: z.array(z.string()),
});
export type Arrival = z.infer<typeof Arrival>;

export const MailEvent = z.union([
  Arrival,
  /** A mail that couldn't be fetched after every attempt. */
  z.object({ kind: z.literal('unreadable'), id: z.string() }),
  /** The mailbox itself has been unreachable for a while. */
  z.object({ kind: z.literal('trouble'), message: z.string() }),
]);
export type MailEvent = z.infer<typeof MailEvent>;

const errorChars = 200;

export type Inbox = {
  /**
   * Asks Gmail what is new, saves it, and returns every id waiting to be
   * handled: those with a decision whose action isn't finished, then the
   * new ones. The first time ever, it only records the position: old mail
   * wakes nobody.
   */
  readonly poll: () => Promise<readonly string[]>;
  /** Fetches a waiting mail and keeps its redacted copy. Undefined, and done, if it is gone or a draft. */
  readonly open: (id: string) => Promise<Arrival | undefined>;
  /** The mail last opened under this id, in full. In memory only. */
  readonly mail: (id: string) => Mail | undefined;
  /** A mail by id, straight from Gmail. */
  readonly fetch: (id: string) => Promise<Mail | undefined>;
  /** The decision already made about a mail, if its action didn't finish. */
  readonly decision: (id: string) => Promise<Decision | undefined>;
  /** Saves the decision before its action. */
  readonly decided: (id: string, decision: Decision) => Promise<void>;
  /** The action finished. */
  readonly finished: (id: string) => Promise<void>;
  /**
   * Something failed for this mail. An action is retried on every pass; a
   * read or a triage is counted, and given up on after `maxAttempts`.
   */
  readonly failed: (
    id: string,
    error: unknown
  ) => Promise<{ readonly gaveUp: boolean }>;
  /** Marks a mail whose wake is running, so passes leave it alone until `release`. */
  readonly hold: (id: string) => void;
  readonly release: (id: string) => void;
  readonly held: (id: string) => boolean;
  /** Forgets mail done long ago. */
  readonly sweep: () => Promise<void>;
  /** The watcher's state, for whoever reports on it. */
  readonly state: () => Promise<WatchState | undefined>;
};

export const inbox = ({
  file,
  box,
  parse,
  store,
  disk,
  log,
  now,
}: {
  /** Where the watcher's state is kept. */
  readonly file: string;
  readonly box: ReadOnlyMailbox;
  readonly parse: (raw: RawMail) => Mail;
  readonly store: Pick<Store, 'save' | 'takeBack' | 'tookBack'>;
  readonly disk: Pick<Disk, 'read' | 'write'>;
  /** Mail's log. */
  readonly log: (entry: object) => Promise<void>;
  readonly now: () => Temporal.Instant;
}): Inbox => {
  const opened = new Map<string, Mail>();
  const holding = new Set<string>();

  // One read and write at a time: a wake that ends while a pass is running
  // must not lose the pass's write, or the other way round.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
  const read = () => readJson(disk, file, WatchState);
  const write = (state: WatchState) =>
    disk.write(file, `${JSON.stringify(state)}\n`);
  /** Changes the state, if there is one. */
  const change = (
    alter: (state: WatchState) => WatchState
  ): Promise<WatchState | undefined> =>
    serial(async () => {
      const state = await read();
      if (state === undefined) return undefined;
      const next = alter(state);
      await write(next);
      return next;
    });
  const without = <Value>(
    record: Readonly<Record<string, Value>>,
    id: string
  ): Record<string, Value> => {
    const { [id]: _, ...rest } = record;
    return rest;
  };
  const done = (state: WatchState, id: string): WatchState => ({
    ...state,
    pending: without(state.pending, id),
    acting: without(state.acting, id),
    done: { ...state.done, [id]: now().toString() },
  });
  const fetch = async (id: string) => {
    const raw = await box.get(id);
    return raw === undefined ? undefined : parse(raw);
  };

  return {
    poll: () =>
      serial(async () => {
        const state = await read();
        if (state === undefined) {
          // First run: start from now, not by waking on 200 old mails.
          const position = await box.position();
          await write({ position, pending: {}, acting: {}, done: {} });
          await log({ event: 'start', position });
          return [];
        }
        const since = await box.since(state.position);
        const fresh =
          since.kind === 'ok'
            ? since
            : // Gmail forgot the position. Everything recent, deduped by `done`.
              {
                ids: await box.search(resyncQuery),
                position: await box.position(),
              };
        if (since.kind === 'expired')
          await log({ event: 'resync', found: fresh.ids.length });
        const pending = { ...state.pending };
        for (const id of fresh.ids)
          if (
            state.done[id] === undefined &&
            state.acting[id] === undefined &&
            pending[id] === undefined
          )
            pending[id] = 0;
        // What the review handed back is acted on again, with the review's decision.
        const missed = await store.takeBack();
        const acting = { ...state.acting };
        for (const { id, decision } of missed) {
          acting[id] = decision;
          delete pending[id];
        }
        // Saved first: from here a crash can't lose these ids.
        await write({ ...state, position: fresh.position, pending, acting });
        if (missed.length > 0) await store.tookBack();
        return [...Object.keys(acting), ...Object.keys(pending)].filter(
          (id) => !holding.has(id)
        );
      }),
    open: async (id) => {
      const raw = await box.get(id);
      if (raw === undefined || raw.labelIds?.includes('DRAFT') === true) {
        await log({ event: raw === undefined ? 'gone' : 'draft', id });
        await change((state) => done(state, id));
        return undefined;
      }
      const mail = parse(raw);
      const { links } = await store.save(mail);
      opened.set(id, mail);
      return {
        kind: 'mail',
        id,
        threadId: mail.threadId,
        domain: domainOf(mail),
        authenticated: mail.authenticated,
        colleague: mail.colleague,
        links,
      };
    },
    mail: (id) => opened.get(id),
    fetch,
    decision: async (id) => (await serial(read))?.acting[id],
    decided: async (id, decision) => {
      await change((state) => ({
        ...state,
        pending: without(state.pending, id),
        acting: { ...state.acting, [id]: decision },
      }));
    },
    finished: async (id) => {
      opened.delete(id);
      await change((state) => done(state, id));
    },
    failed: async (id, error) => {
      const message = oneLine(String(error), errorChars);
      let entry: object = {};
      let gaveUp = false;
      await change((state) => {
        if (state.acting[id] !== undefined) {
          entry = { event: 'act-error', id, message };
          return state;
        }
        const tries = (state.pending[id] ?? 0) + 1;
        entry = { event: 'triage-error', id, tries, message };
        gaveUp = tries >= maxAttempts;
        return gaveUp
          ? done(state, id)
          : { ...state, pending: { ...state.pending, [id]: tries } };
      });
      await log(entry);
      if (gaveUp) {
        opened.delete(id);
        await log({ event: 'gave-up', id });
      }
      return { gaveUp };
    },
    hold: (id) => {
      holding.add(id);
    },
    release: (id) => {
      holding.delete(id);
    },
    held: (id) => holding.has(id),
    sweep: async () => {
      const cutoff = now().subtract({ hours: rememberDoneDays * 24 });
      await change((state) => ({
        ...state,
        done: Object.fromEntries(
          Object.entries(state.done).filter(([, at]) => {
            const when = At.safeParse(at);
            return (
              when.success && Temporal.Instant.compare(when.data, cutoff) >= 0
            );
          })
        ),
      }));
    },
    state: () => serial(read),
  };
};

/** One pass over the mailbox: every mail waiting to be handled, as events. Throws only for a mailbox it can't reach at all. */
export async function* pass(
  inbox: Pick<Inbox, 'poll' | 'open' | 'failed' | 'sweep'>
): AsyncGenerator<MailEvent> {
  for (const id of await inbox.poll()) {
    const event = await inbox
      .open(id)
      .catch(
        async (error: unknown): Promise<MailEvent | undefined> =>
          (await inbox.failed(id, error)).gaveUp
            ? { kind: 'unreadable', id }
            : undefined
      );
    if (event !== undefined) yield event;
  }
  await inbox.sweep();
}

/** The note a mail gets when it could never be read or triaged. */
export const untriaged: Decision = {
  action: 'note',
  category: 'untriaged',
  reason: 'triage kept failing',
};

const reasonChars = 200;

/** The log line for a decision: a redacted subject, no body. */
export const logged = (mail: Mail, decision: Decision): object => ({
  id: mail.id,
  thread: mail.threadId,
  from: domainOf(mail),
  subject: oneLine(mail.subject),
  authenticated: mail.authenticated,
  colleague: mail.colleague,
  action: decision.action,
  category: decision.category,
  reason: oneLine(decision.reason, reasonChars),
  p: decision.p,
});

export type Handling = {
  readonly inbox: Pick<
    Inbox,
    'mail' | 'fetch' | 'decision' | 'decided' | 'finished' | 'failed' | 'held'
  >;
  /** Decides what to do with a mail. Throws when the model can't be asked. */
  readonly triage: (mail: Mail) => Promise<Decision>;
  /** Carries a decision out. */
  readonly act: (mail: Mail, decision: Decision) => Promise<void>;
  /** Records a mail the filter dropped, for the daily review. */
  readonly filtered: (mail: Mail, decision: Decision) => Promise<void>;
  /** Mail's log. */
  readonly log: (entry: object) => Promise<void>;
};

/**
 * Handles one mail from a pass: decides, unless a decision was already
 * saved; saves the decision; acts; and marks it done. A failure leaves the
 * mail where the next pass will find it.
 */
export const handle = async (
  event: Exclude<MailEvent, { readonly kind: 'trouble' }>,
  { inbox, triage, act, filtered, log }: Handling
): Promise<void> => {
  const { id } = event;
  if (event.kind === 'unreadable') {
    // It could never be fetched. One last try, so it can at least be noted.
    const mail = await inbox.fetch(id).catch(() => undefined);
    if (mail !== undefined) await act(mail, untriaged).catch(() => undefined);
    return;
  }
  try {
    const mail = inbox.mail(id) ?? (await inbox.fetch(id));
    if (mail === undefined) throw new Error(`mail ${id} is gone`);
    const saved = await inbox.decision(id);
    const decision = saved ?? (await triage(mail));
    if (saved === undefined) {
      // A crash in the action redoes the action, never the decision.
      await inbox.decided(id, decision);
      await log(logged(mail, decision));
      if (decision.action === 'ignore') await filtered(mail, decision);
    }
    await act(mail, decision);
    // A mail whose wake is still running is finished when the wake is.
    if (!inbox.held(id)) await inbox.finished(id);
  } catch (error) {
    const mail = inbox.mail(id);
    const { gaveUp } = await inbox.failed(id, error);
    if (gaveUp && mail !== undefined)
      await act(mail, untriaged).catch(() => undefined);
  }
};
