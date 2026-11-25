import { createHash } from 'node:crypto';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { Chat } from '../chat/macro.ts';
import { draftStore } from './drafts.ts';
import { sdkMailbox } from './macro.ts';
import { email } from './service.ts';

/** The owner of the mailbox area's state. */
export const owner = 'mailbox';
const draftsDirectory = 'drafts';

/**
 * The mailbox area's context: `mailbox`, the agent's own email. The mailbox
 * port and the drafts stay inside it, so a script gets only its operations.
 * Drafts are shown, and approvals read, in the owner's DM through the chat
 * area's port.
 */
export const mailboxContext = (
  {
    macro,
    trace,
    state,
    join,
    disk,
    clock,
    config,
  }: Pick<
    Base,
    'macro' | 'trace' | 'state' | 'join' | 'disk' | 'clock' | 'config'
  >,
  chat: Pick<Chat, 'me' | 'dm' | 'context'>
) =>
  behavior().decorate({
    mailbox: email({
      mailbox: sdkMailbox({ macro, trace }),
      drafts: draftStore({
        directory: join(state.run(owner), draftsDirectory),
        join,
        disk,
        id: () => crypto.randomUUID(),
        now: () => clock.now(),
      }),
      chat,
      owner: () => config.owner,
      now: () => clock.now(),
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      trace,
    }),
  });

export type MailboxArea = ContextOf<ReturnType<typeof mailboxContext>>;
