/**
 * The secrets area's context: the vault client, the clipboard and the poll
 * schedule, built once. The only file of the area that touches the world.
 */
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import type { Base } from '../../context/index.ts';
import { attributionProblem, mintWakeId } from './attribution.ts';
import { xClipboard } from './clipboard.ts';
import { wakeVariable } from './config.ts';
import { polling, type SecretsPorts } from './ports.ts';
import { vault } from './vault.ts';

const randomBytes = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(10));

/**
 * The wake a call belongs to. A script's process is given it by the running
 * agent; anything else (the agent's own polling, `bin/agent` from a shell)
 * runs outside any wake, and mints a fresh id for each call.
 */
const wakeIds = (
  given: string | undefined,
  clock: Base['clock']
): (() => string) => {
  if (given === undefined || given === '')
    return () => mintWakeId(clock.now(), randomBytes());
  if (attributionProblem(given, clock.now()) === 'not a UUIDv7')
    return () => {
      throw new Error(`${wakeVariable} is not a UUIDv7`);
    };
  return () => given;
};

export const secretsContext = (
  { macro, shell, clock }: Pick<Base, 'macro' | 'shell' | 'clock'>,
  schedules: Pick<Schedules, 'set' | 'list' | 'remove'>
) => {
  let team: Promise<string> | undefined;
  const secrets: SecretsPorts = {
    vault: vault({
      fetch: (request) => fetch(request),
      // In a script's process this is the relay, which swaps its capability for the agent's key.
      endpoint: async () => {
        const client = (await macro())._client;
        const auth = client.authConfig;
        if (auth.type !== 'user' || typeof auth.apiKey !== 'string')
          throw new Error("the vault takes the agent's user API key");
        return { origin: client.hosts.storage, key: auth.apiKey };
      },
      team: () => {
        team ??= macro()
          .then((client) => client.teams.current())
          .then(({ id }) => id);
        return team;
      },
      wakeId: wakeIds(process.env[wakeVariable], clock),
      operationId: () => mintWakeId(clock.now(), randomBytes()),
      clock,
      jitter: () =>
        (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32,
    }),
    clipboard: xClipboard({ shell, clock }),
    polling: polling(schedules),
  };
  return behavior<Base>().decorate({ secrets });
};

export type SecretsContext = ContextOf<ReturnType<typeof secretsContext>>;
