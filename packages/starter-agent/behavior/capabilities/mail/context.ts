import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { ChatContext } from '../chat/context.ts';
import { files, filterFile, owner, shared } from './config.ts';
import { gmailApi } from './gmail.ts';
import { mailAccess, mailPorts } from './ports.ts';
import { whoOf } from './trust.ts';

const lockWaitMs = 30_000;
const lockRetryMs = 100;
/** A lock file that never got its owner written is forgotten after this long. */
const lockStaleSeconds = 60;

const exists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'EEXIST';

/**
 * Runs `work` while holding a lock file, so two processes never do it at
 * once. The file names its holder, and a holder that died is not waited for.
 */
const locked =
  ({
    file,
    shell,
    clock,
  }: Pick<Base, 'shell' | 'clock'> & { readonly file: string }) =>
  async <Result>(work: () => Promise<Result>): Promise<Result> => {
    await mkdir(dirname(file), { recursive: true });
    const deadline = clock.now().add({ milliseconds: lockWaitMs });
    for (;;) {
      try {
        await writeFile(file, String(process.pid), { flag: 'wx' });
        break;
      } catch (error) {
        if (!exists(error)) throw error;
      }
      const holder = Number(await readFile(file, 'utf8').catch(() => ''));
      const dead =
        Number.isInteger(holder) && holder > 0 && !shell.alive(holder);
      const abandoned =
        !(Number.isInteger(holder) && holder > 0) &&
        (await stat(file)
          .then(
            ({ mtimeMs }) =>
              clock
                .now()
                .since(
                  Temporal.Instant.fromEpochMilliseconds(Math.round(mtimeMs))
                )
                .total('seconds') > lockStaleSeconds
          )
          .catch(() => false));
      if (dead || abandoned) {
        await rm(file, { force: true });
        continue;
      }
      if (Temporal.Instant.compare(clock.now(), deadline) >= 0)
        throw new Error('reply lock busy');
      await clock.sleep(lockRetryMs);
    }
    try {
      return await work();
    } finally {
      await rm(file, { force: true });
    }
  };

/** Where a run says it is about to sign in somewhere, so the notice that follows isn't taken for an alert. */
export type SignIns = {
  /** Sign-in notices from this domain are expected until then. */
  readonly expect: (domain: string, until: Temporal.Instant) => Promise<void>;
};

/**
 * What mail adds to the agent's context, as `mail`: its own mailbox,
 * read-only; the one gated way to reply; the watcher's state; and what the
 * filter is weighed against; and `signIns`, where a run says it is about to
 * sign in somewhere. It needs chat, for the cheap model that answers the
 * filter's questions and for the DM to the owner.
 *
 * The mailbox is the address in the agent's settings (`email`), and it is
 * optional: until its credentials are added, `configured` says no, the
 * watcher stays idle, and anything that needs Gmail throws `notSetUp`.
 */
export const mailContext = ({
  config,
  state,
  disk,
  clock,
  shell,
  credentials,
  join,
}: Base) => {
  const access = mailAccess(credentials);
  const filterPath = join(config.root, ...filterFile);
  const mail = mailPorts({
    box: gmailApi({
      credentials: access.read,
      fetch,
      clock,
    }),
    configured: access.configured,
    who: whoOf(config.identity.email, config.owner),
    name: config.identity.name,
    disk,
    clock,
    join,
    directories: {
      private: state.private(owner),
      run: state.run(owner),
      memory: state.memory(owner),
      log: state.log(owner),
    },
    places: {
      notes: state.sharedFile(shared.notes),
      asks: state.sharedFile(shared.asks),
      filter: filterPath,
    },
    locked: locked({
      file: join(state.run(owner), files.replyLock),
      shell,
      clock,
    }),
    // Imported afresh whenever the file has changed, so a change to the
    // filter takes effect without a restart.
    importFilter: async () =>
      import(
        `${filterPath}?at=${(await disk.modified(filterPath))?.epochMilliseconds ?? 0}`
      ),
    tag: () =>
      [...crypto.getRandomValues(new Uint8Array(6))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
  });
  // Sign-ins a run announces (the tools area's sign-up does) are kept where
  // the filter looks for them, so the service's notice isn't an alert.
  const signIns: SignIns = { expect: mail.store.expect };
  return behavior<ChatContext>().decorate({ mail, signIns });
};

export type MailContext = ContextOf<ReturnType<typeof mailContext>>;
