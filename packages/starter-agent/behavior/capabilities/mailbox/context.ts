import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import { sdkMailbox } from './macro.ts';

/** The mailbox area's context: `mailbox`, the agent's own email. */
export const mailboxContext = ({
  macro,
  trace,
}: Pick<Base, 'macro' | 'trace'>) =>
  behavior().decorate({ mailbox: sdkMailbox({ macro, trace }) });

export type MailboxArea = ContextOf<ReturnType<typeof mailboxContext>>;
