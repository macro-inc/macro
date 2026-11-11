/**
 * The agent's credentials, by name only: which it holds, storing a new one
 * without seeing it, and handing one to a program without passing through
 * the model.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import { credentialLog } from './config.ts';
import type { ToolsContext } from './context.ts';
import {
  checkName,
  checkSecret,
  newPassword,
  printedValue,
  redact,
} from './secrets.ts';
import { totp } from './totp.ts';

/** The parts of the context a capability reads. */
type Needs<Keys extends keyof ToolsContext> = Pick<ToolsContext, Keys>;

/**
 * The names of every credential you hold. Names only, never values.
 *
 * A service's credentials are named <SERVICE>_<WHAT>, e.g.
 * EXAMPLE_API_KEY. To use one, hand it to a program with useCredential;
 * nothing gives you a value. Something you can't do for want of a
 * credential says which one: your owner can give it to you, and you store
 * it with setCredential.
 */
export const listCredentials = ({
  credentials,
}: Needs<'credentials'>): Promise<readonly string[]> => credentials.names();

/** Whether you hold a credential by this name. */
export const hasCredential = (
  { credentials }: Needs<'credentials'>,
  { name }: { readonly name: string }
): Promise<boolean> => credentials.has(name);

/**
 * Store a credential: a password it generates, a program's output, or a
 * value.
 *
 * The only way a password or key is stored. Give exactly one of:
 * - `generate: true`: a new 32-character password, which nobody ever sees.
 * - `fromCommand`: a program and its arguments; what it prints is stored (a
 *   JSON string is unwrapped). Use it to take a key straight from where it
 *   is made, so it never passes through you.
 * - `value`: a value you were given. Avoid it when one of the others will do.
 * The name is upper case letters, digits and underscores. An empty value,
 * one under 16 characters, or one with whitespace is refused and nothing is
 * stored. Replaces any credential of the same name. Returns the name and the
 * value's length, never the value.
 */
export const setCredential = async (
  {
    credentials,
    random,
    shell,
    log,
    tools,
  }: Needs<'credentials' | 'random' | 'shell' | 'log' | 'tools'>,
  {
    name,
    generate,
    fromCommand,
    value,
  }: {
    readonly name: string;
    readonly generate?: true;
    readonly fromCommand?: readonly [string, ...string[]];
    readonly value?: string;
  }
): Promise<{ readonly name: string; readonly length: number }> => {
  const given = [generate, fromCommand, value].filter(
    (way) => way !== undefined
  ).length;
  if (given !== 1)
    throw new Error('give exactly one of generate, fromCommand and value');
  // The name is checked before anything runs, so a bad one costs nothing.
  checkName(name);
  const found = async (argv: readonly string[]): Promise<string> => {
    const ran = await shell.run(argv, { timeoutMs: tools.commandTimeoutMs });
    if (ran.code !== 0)
      throw new Error(
        `${argv[0]} exited ${ran.code}; nothing stored for ${name}`
      );
    return printedValue(ran.stdout);
  };
  const checked = checkSecret(
    name,
    generate === true
      ? newPassword(random)
      : fromCommand !== undefined
        ? await found(fromCommand)
        : (value ?? '')
  );
  await credentials.set(name, checked);
  await log.event(credentialLog, { set: name, length: checked.length });
  return { name, length: checked.length };
};

/**
 * Run a program with a credential on its stdin or in its environment.
 *
 * How a credential reaches the thing that needs it without passing through
 * you. `argv` is the program and its arguments. `stdin` names the credential
 * written to its stdin; with `as: "totp"` the credential is a base32 TOTP
 * secret and the current 6-digit code is written instead. `env` maps
 * environment variables to credential names, e.g. { argv: ["curl", "-H",
 * "@-", "https://api.example.com"], env: { TOKEN: "EXAMPLE_API_KEY" } }.
 * Returns the exit code and output, with the credential's value cut out of
 * them. Never put a value in `argv`.
 */
export const useCredential = async (
  {
    credentials,
    shell,
    clock,
    tools,
  }: Needs<'credentials' | 'shell' | 'clock' | 'tools'>,
  {
    argv,
    stdin,
    env,
    cwd,
  }: {
    readonly argv: readonly [string, ...string[]];
    readonly stdin?: {
      readonly credential: string;
      readonly as?: 'value' | 'totp';
    };
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
  }
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> => {
  const typed =
    stdin === undefined
      ? undefined
      : stdin.as === 'totp'
        ? await totp(await credentials.get(stdin.credential), clock.now())
        : await credentials.get(stdin.credential);
  const variables = await Promise.all(
    Object.entries(env ?? {}).map(
      async ([variable, name]) =>
        [variable, await credentials.get(name)] as const
    )
  );
  const ran = await shell.run(argv, {
    cwd,
    stdin: typed,
    env: Object.fromEntries(variables),
    timeoutMs: tools.commandTimeoutMs,
  });
  const secrets = [typed ?? '', ...variables.map(([, value]) => value)];
  return {
    code: ran.code,
    stdout: redact(ran.stdout, secrets),
    stderr: redact(ran.stderr, secrets),
  };
};

export const toolsModule = module({
  name: 'tools',
  summary:
    'Your credentials, by name only: which you hold, storing one, and handing one to a program.',
  file: import.meta.path,
  functions: {
    listCredentials,
    hasCredential,
    setCredential,
    useCredential,
  },
});

export const toolsCapabilities =
  behavior<ToolsContext>().capability(toolsModule);
