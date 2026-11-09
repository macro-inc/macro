import type { CommandListener, LexicalCommand } from '../commands';
import type { DequeSet } from './deque-set';

export type CommandBucket<P> = readonly [
  DequeSet<CommandListener<P>>,
  DequeSet<CommandListener<P>>,
  DequeSet<CommandListener<P>>,
  DequeSet<CommandListener<P>>,
  DequeSet<CommandListener<P>>,
];
export type CommandRegistry = Map<
  LexicalCommand<unknown>,
  CommandBucket<unknown>
>;
