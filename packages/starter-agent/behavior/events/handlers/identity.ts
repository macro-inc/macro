import { behavior } from '@macro-inc/muppet/core/behavior';
import { readIdentity } from '../../capabilities/identity/index.ts';
import {
  givenName,
  known,
  unknown,
} from '../../capabilities/identity/prompt.ts';
import type { Base } from '../../context/index.ts';

/** Every wake is told who the agent is, or that it doesn't know yet and how to find out. */
export const identityHandlers = () =>
  behavior<Base>().on(
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
