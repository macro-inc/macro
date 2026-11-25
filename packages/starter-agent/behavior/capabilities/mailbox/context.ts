import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import { draftStore } from './drafts.ts';
import { sdkMailbox } from './macro.ts';

/** The owner of the mailbox area's state. */
export const owner = 'mailbox';
const draftsDirectory = 'drafts';

/**
 * The mailbox area's context: the agent's own mailbox, and the drafts it has
 * shown its owner. Its chat (for showing drafts and reading approvals) is the
 * chat area's.
 */
export const mailboxContext = ({
  macro,
  trace,
  state,
  join,
  disk,
}: Pick<Base, 'macro' | 'trace' | 'state' | 'join' | 'disk'>) =>
  behavior().decorate({
    mailbox: sdkMailbox({ macro, trace }),
    drafts: draftStore({
      directory: join(state.run(owner), draftsDirectory),
      join,
      disk,
      id: () => crypto.randomUUID(),
    }),
  });

export type MailboxArea = ContextOf<ReturnType<typeof mailboxContext>>;
