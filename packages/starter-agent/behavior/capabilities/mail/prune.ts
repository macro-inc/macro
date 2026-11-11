import type { Base } from '../../context/index.ts';
import type { Rule } from '../heartbeat/prune.ts';
import { files, owner } from './config.ts';

/**
 * What the heartbeat prunes for mail: the redacted copies of old mail (the
 * mail itself stays in Gmail), and the record the limits count from. Mail's
 * logs are pruned with every other log.
 */
export const mailPruneRules = ({
  state,
  join,
  config,
}: Pick<Base, 'state' | 'join' | 'config'>): readonly Rule[] => [
  {
    kind: 'expire',
    directory: join(state.private(owner), files.messages),
    days: config.keep.logDays,
  },
  {
    kind: 'trimFile',
    file: join(state.private(owner), files.events),
    lines: config.keep.logLines,
  },
];
