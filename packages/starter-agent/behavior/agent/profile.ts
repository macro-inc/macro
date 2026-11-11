import type { EventContext } from '@macro-inc/muppet/core/agent';
import type { Config } from '../context/config.ts';
import type { Profile } from './claude.ts';

const minute = 60_000;

type Limits = Pick<Profile, 'budgetUsd' | 'timeoutMs'>;

/**
 * What a wake may spend and how long it may take, by the source of the
 * event that led to it. A reply run only talks, so it is short and cheap:
 * the next message in its conversation waits until it ends, and anything
 * longer is handed to a later run of its own with doLater.
 */
export const limits: Readonly<Record<string, Limits>> = {
  conversations: { budgetUsd: 3, timeoutMs: 5 * minute },
  schedules: { budgetUsd: 10, timeoutMs: 120 * minute },
};

const otherwise: Limits = { budgetUsd: 10, timeoutMs: 60 * minute };

/** Every wake works in the agent's own repository, and nowhere else. */
export const profile =
  (config: Pick<Config, 'root'>) =>
  (event: EventContext): Profile => ({
    ...(limits[event.name] ?? otherwise),
    cwd: config.root,
    directories: [],
  });
