import type { Wake } from '@macro-inc/muppet/core/behavior';
import { behavior } from '@macro-inc/muppet/core/behavior';
import type { Source } from '@macro-inc/muppet/core/event';
import type { Fired } from '@macro-inc/muppet/utilities/schedules';
import {
  checkAccessRequests,
  decidedNote,
  decidedWake,
} from '../../capabilities/secrets/access.ts';
import { logStream, pollSchedule } from '../../capabilities/secrets/config.ts';
import type { Needs } from '../../capabilities/secrets/index.ts';

/** Asks about pending requests, logging (never throwing) when the vault can't be asked. */
const checked = (context: Needs) =>
  checkAccessRequests(context).catch(async (error: unknown) => {
    await context.log.event(logStream, {
      op: 'access',
      outcome: 'check failed',
      error: error instanceof Error ? error.name : 'unknown',
    });
    return [];
  });

/** The poll schedule fired: a decision wakes the agent, once, with what was decided. */
export const pollAccess = async (
  fired: Fired,
  context: Needs & { readonly wake: Wake }
): Promise<void> => {
  if (fired.name !== pollSchedule) return;
  const resolved = await checked(context);
  if (resolved.length === 0) return;
  // The firing doesn't wait on the agent's work.
  void context.wake(decidedWake(resolved));
};

/** Every wake asks too, and is told what was decided since. */
export const noteAccess = async (
  { add }: { readonly add: (text: string) => void },
  context: Needs
): Promise<void> => {
  const resolved = await checked(context);
  if (resolved.length > 0) add(decidedNote(resolved));
};

/**
 * Learning that the owner decided on an access request. The vault's event
 * is a hint at best, so the agent asks: on every wake, and on the
 * `secrets-access` schedule while anything is pending. It needs the
 * scheduler's `schedules` source.
 */
export const secretsHandlers = (clock: {
  readonly sources: { readonly schedules: Source<Fired> };
}) =>
  behavior<Needs>()
    .source({ schedules: clock.sources.schedules })
    .on((sources) => sources.schedules, pollAccess)
    .on((sources) => sources.hooks.preWake, noteAccess);
