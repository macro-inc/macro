import { behavior } from '@macro-inc/muppet/core/behavior';
import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import { isoText } from '@macro-inc/muppet/utilities/time';
import {
  type Needs,
  owner,
  readIdentity,
} from '../../capabilities/identity/index.ts';
import {
  givenName,
  introduce,
  known,
  unknown,
} from '../../capabilities/identity/prompt.ts';
import type { Base } from '../../context/index.ts';

/** The one-off schedule that wakes a new agent to introduce itself. */
export const introduction = 'introduce';
/** Written once the introduction has been scheduled, so a restart doesn't ask again. */
const introducedFile = 'introduced';

/**
 * A new agent introduces itself once: the first time it runs with nothing
 * written about who it is, it is woken to ask its owner. An agent that
 * already knows who it is, or has already been asked to, is left alone.
 */
export const ensureIntroduction = async (
  context: Needs & {
    readonly disk: Pick<Base['disk'], 'read' | 'write' | 'exists'>;
    readonly clock: Base['clock'];
  },
  schedules: Pick<Schedules, 'set'>
): Promise<void> => {
  const marker = context.join(context.state.memory(owner), introducedFile);
  if (await context.disk.exists(marker)) return;
  if ((await readIdentity(context)) === undefined) {
    const set = await schedules.set(introduction, {
      at: isoText(context.clock.now()),
      why: "A new agent's first wake: it asks its owner who it is.",
      data: { wake: introduce },
    });
    if (set.kind === 'invalid') throw new Error(set.error);
  }
  await context.disk.write(marker, `${isoText(context.clock.now())}\n`);
};

/** Each wake uses saved identity when present and the configured name otherwise. */
export const identityHandlers = () =>
  behavior<Needs & { readonly config: Pick<Base['config'], 'identity'> }>().on(
    (sources) => sources.hooks.preWake,
    async ({ add }, context) => {
      const identity = await readIdentity(context);
      add(
        identity === undefined
          ? unknown(givenName(context.config.identity.name))
          : known(identity)
      );
    }
  );
