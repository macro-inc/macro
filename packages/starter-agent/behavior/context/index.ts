/**
 * The agent's context: the one place the outside world is touched.
 * Everything else in its behavior is given these and does no IO of its own, so it can
 * be run against a fake disk, clock, shell or Macro.
 */

import { readFileSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  envFileCredentials,
  parseEnvFile,
  withheldCredentials,
} from '@macro-inc/muppet/utilities/credentials';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { Macro } from '@macro-inc/sdk';
import {
  type Authority,
  authority,
  authorityFiles,
} from '../agent/authority.ts';
import type { Trace } from '../agent/claude.ts';
import {
  type Addresses,
  addresses as addressesFrom,
  type Hosts,
  type ServiceName,
} from './addresses.ts';
import {
  anthropicUpstream,
  childEnvironment,
  claudeAccess,
  claudeKeys,
} from './children.ts';
import { type Config, config as makeConfig, settingsFile } from './config.ts';
import type { Credentials } from './credentials.ts';
import type { Disk } from './disk.ts';
import { agentEnvironment } from './identity.ts';
import { type Log, log as makeLog } from './log.ts';
import { startRelay } from './relay.ts';
import { parseSettings } from './settings.ts';
import type { Shell } from './shell.ts';
import { timedOut } from './shell.ts';
import { sopsCredentials } from './sops.ts';
import { type Configured, type Startup, variables } from './startup.ts';
import { state as makeState, type State } from './state.ts';
import { trace } from './telemetry.ts';

/** The credential holding the key of the agent's own Macro account. */
export const macroKey = 'MACRO_API_KEY';

type Environment = Readonly<Record<string, string | undefined>>;

export type Base = {
  readonly config: Config;
  /** Who gives orders; the agent's own process refreshes it before each wake. */
  readonly authority: Authority;
  readonly state: State;
  readonly disk: Disk;
  /** The same disk, under the name lib's utilities ask for. */
  readonly files: Disk;
  readonly clock: Clock;
  readonly shell: Shell;
  readonly credentials: Credentials;
  readonly log: Log;
  /** Joins path parts. Injected so nothing else imports a path library. */
  readonly join: (...parts: readonly string[]) => string;
  /** The agent in Macro, as its own account. Connects on first use. */
  readonly macro: () => Promise<Macro>;
  /** The environment that makes a child process act as the agent. */
  readonly environment: () => Promise<
    Readonly<Record<string, string | undefined>>
  >;
  /**
   * The relay this process reaches Macro through: the one it was given (a
   * script's or a call's process), or the agent's own, started on first use.
   */
  readonly relay: () => Promise<Relayed>;
  /** The environment a child needs to call back into this agent: see `Wiring.relayed`. */
  readonly relayed: () => Promise<Readonly<Record<string, string>>>;
  /** Spans around an area's operations. */
  readonly trace: Trace;
  /** What a child is started under so it can't read the enrollment's secrets: `Startup.sandbox`. */
  readonly sandbox: readonly string[];
  /** The DevTools endpoint of the agent's browser (`Startup.browserEndpoint`). */
  readonly browserEndpoint: string;
};

/** A relay's address and the capability it takes. */
export type Relayed = { readonly url: string; readonly token: string };

/** How this process is wired to the world beyond its context: the launcher, its children and Macro. */
export type Wiring = {
  /** Where the agent reaches Macro, from its credentials. */
  readonly addresses: () => Promise<Addresses>;
  /**
   * The environment a child needs to call back into this agent (`bin/agent`,
   * a script's process): its workspace, and Macro through this process's
   * relay, never its key. The relay starts on first use.
   */
  readonly relayed: () => Promise<Readonly<Record<string, string>>>;
  /** What Claude Code needs to reach Anthropic, if enrollment gave it (Macro-credits mode); nothing otherwise. */
  readonly claudeAccess: () => Promise<Readonly<Record<string, string>>>;
};

const missing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';

const orMissing =
  <Value>(fallback: Value) =>
  (error: unknown): Value => {
    if (missing(error)) return fallback;
    throw error;
  };

export const disk: Disk = {
  read: (path) => readFile(path, 'utf8').catch(orMissing(undefined)),
  // To a temporary file and renamed, so a reader never sees half of one.
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, path);
  },
  append: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text);
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
  rename: (from, to) =>
    mkdir(dirname(to), { recursive: true })
      .then(() => rename(from, to))
      .then(() => true)
      .catch(orMissing(false)),
  list: async (directory) =>
    (await readdir(directory).catch(orMissing<string[]>([]))).sort(),
  exists: (path) =>
    stat(path)
      .then(() => true)
      .catch(orMissing(false)),
  modified: (path) =>
    stat(path)
      .then((stats) =>
        Temporal.Instant.fromEpochMilliseconds(Math.round(stats.mtimeMs))
      )
      .catch(orMissing(undefined)),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
};

export const clock: Clock = {
  now: () => Temporal.Now.instant(),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
};

// A child gets the baseline of this process's environment and what its caller adds, never all of it.
const environmentWith = (overrides: Environment = {}): Record<string, string> =>
  childEnvironment(process.env, overrides);

export const shell: Shell = {
  run: async (argv, options = {}) => {
    const child = Bun.spawn([...argv], {
      cwd: options.cwd,
      env: environmentWith(options.env),
      stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let late = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            late = true;
            child.kill('SIGKILL');
          }, options.timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    return { code: late ? timedOut : code, stdout, stderr };
  },
  start: (argv, options = {}) => {
    const out = options.log === undefined ? 'ignore' : Bun.file(options.log);
    const child = Bun.spawn([...argv], {
      cwd: options.cwd,
      env: environmentWith(options.env),
      stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
      stdout: out,
      stderr: out,
      detached: options.detached,
    });
    if (options.detached) child.unref();
    return {
      pid: child.pid,
      exited: child.exited,
      kill: () => child.kill('SIGTERM'),
    };
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

const logOwner = 'agent';

/** Every service the SDK knows, so a script's client sends none of them past the relay. */
const allServices: readonly ServiceName[] = [
  'agent-harness',
  'storage',
  'auth',
  'email',
  'calendar',
  'cognition',
  'notification',
  'properties',
  'search',
  'scheduled-action',
  'static-files',
  'connection',
  'contacts',
  'unfurl',
];

const relayHosts = (url: string): Hosts =>
  Object.fromEntries(allServices.map((name) => [name, `${url}/${name}`]));

const configured = <Value>(value: Value): Configured<Value> => ({
  kind: 'configured',
  value,
});

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** Values the credentials hold, by name, leaving out the ones they don't. */
const held = async (
  credentials: Credentials,
  names: readonly string[]
): Promise<Readonly<Record<string, string>>> =>
  Object.fromEntries(
    (
      await Promise.all(
        names.map(async (name) =>
          (await credentials.has(name))
            ? [[name, await credentials.get(name)] as const]
            : []
        )
      )
    ).flat()
  );

/** Where the credentials come from, and where Macro is: a startup error names what is wrong. */
const source = (
  startup: Startup,
  secrets: { readonly file: string; readonly sops: string }
): Configured<{
  readonly credentials: Credentials;
  readonly addresses: () => Promise<Addresses>;
  /** The relay a script reaches Macro through: given to a script's process, made by the agent's. */
  readonly relay?: {
    readonly url: string;
    readonly token: string;
    readonly claude: Readonly<Record<string, string>>;
  };
}> => {
  const from = startup.credentials;
  if (from.kind === 'relayed')
    return configured({
      credentials: withheldCredentials(from.names),
      addresses: async () => {
        throw new Error(
          "a script's process reaches Macro only through its relay"
        );
      },
      relay: { url: from.url, token: from.token, claude: from.claude },
    });
  if (from.kind === 'file') {
    const text = readText(from.file);
    if (text === undefined)
      return {
        kind: 'invalid',
        message: `${variables.credentialsFile} (${from.file}) can't be read`,
      };
    const parsed = parseEnvFile(text);
    if (parsed.kind === 'malformed')
      return {
        kind: 'invalid',
        message: `${from.file} line ${parsed.line}: ${parsed.reason}`,
      };
    const found = addressesFrom(parsed.values);
    if (found.kind === 'invalid')
      return { kind: 'invalid', message: `${from.file}: ${found.message}` };
    return configured({
      credentials: envFileCredentials({
        file: from.file,
        values: parsed.values,
      }),
      addresses: async () => found.value,
    });
  }
  const credentials = sopsCredentials({ ...secrets, shell });
  return configured({
    credentials,
    // Decrypted on first use, so where Macro is is only known then.
    addresses: async () => {
      const found = addressesFrom(
        Object.fromEntries(
          await Promise.all(
            (await credentials.names()).map(
              async (name) => [name, await credentials.get(name)] as const
            )
          )
        )
      );
      if (found.kind === 'invalid')
        throw new Error(`${secrets.file}: ${found.message}`);
      return found.value;
    },
  });
};

/** Builds the real context for the agent its startup configuration describes. */
export const base = (
  startup: Startup
): Configured<{ readonly base: Base; readonly wiring: Wiring }> => {
  const root = startup.workspace;
  // The settings are read once, as the process starts: a change takes a restart.
  const file = join(root, settingsFile);
  const settings = (() => {
    try {
      return configured(parseSettings(readText(file), file));
    } catch (error) {
      return {
        kind: 'invalid' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  if (settings.kind === 'invalid') return settings;
  const state = makeState({ root, join });
  let owners: Authority | undefined;
  const config = makeConfig({
    root,
    home: homedir(),
    join,
    settings: settings.value,
    owner: () => owners?.owner() ?? settings.value.owner,
  });
  const found = source(startup, { file: config.secrets, sops: config.sops });
  if (found.kind === 'invalid') return found;
  const { credentials, addresses, relay: given } = found.value;
  let macro: Promise<Macro> | undefined;
  let relay: Promise<Relayed> | undefined;
  const ownRelay = () => {
    relay ??= Promise.all([addresses(), credentials.get(macroKey)]).then(
      ([{ hosts, egress }, apiKey]) =>
        held(credentials, claudeKeys).then((claude) =>
          startRelay({
            targets: hosts,
            egress,
            apiKey,
            anthropic: anthropicUpstream(claude),
          })
        )
    );
    return relay;
  };
  // Claude Code, wherever it is started, reaches Anthropic through the relay.
  const claude = async (): Promise<Readonly<Record<string, string>>> =>
    given === undefined
      ? claudeAccess(await held(credentials, claudeKeys), await ownRelay())
      : given.claude;
  const relayed = async () => {
    const { url, token } = given ?? (await ownRelay());
    return {
      [variables.workspace]: root,
      [variables.relayUrl]: url,
      [variables.relayToken]: token,
      [variables.credentialNames]: (await credentials.names()).join(','),
      ...(await claude()),
    };
  };
  const macroClient = () => {
    macro ??=
      given === undefined
        ? Promise.all([addresses(), credentials.get(macroKey)]).then(
            ([{ hosts }, apiKey]) =>
              new Macro({ auth: { type: 'user', apiKey }, hosts })
          )
        : Promise.resolve(
            new Macro({
              auth: { type: 'user', apiKey: given.token },
              hosts: relayHosts(given.url),
            })
          );
    return macro;
  };
  // A script's process reads what the agent's process last decided.
  const files = authorityFiles(state, join);
  owners = authority({
    configured: settings.value.owner,
    initial: readText(files.current)?.trim() || undefined,
    team: async () => {
      const team = await (await macroClient()).teams.current();
      const [owner, members] = await Promise.all([
        team.owner(),
        team.members(),
      ]);
      return { owner: owner.id, members: members.map(({ user }) => user.id) };
    },
    disk,
    files,
    tell: async (to, text) => {
      const client = await macroClient();
      const channel = await client.channels.dm(client.users.byId(to));
      await channel.send(text);
    },
  });
  return configured({
    base: {
      config,
      authority: owners,
      state,
      disk,
      files: disk,
      clock,
      shell,
      credentials,
      join,
      log: makeLog({ directory: state.log(logOwner), join, disk, clock }),
      macro: macroClient,
      environment: () => agentEnvironment({ config, credentials }),
      relay: async () => given ?? (await ownRelay()),
      relayed,
      trace,
      sandbox: startup.sandbox,
      browserEndpoint: startup.browserEndpoint,
    },
    wiring: {
      addresses,
      relayed,
      claudeAccess: claude,
    },
  });
};
