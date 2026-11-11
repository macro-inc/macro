import { z } from 'zod';
import { claudeKeys } from './children.ts';

/**
 * What the agent's process is told as it starts, all from its environment
 * and none of it defaulted: the launcher sets every place it uses, so a
 * missing one is a mistake to report, never a guess to make.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** A value, or what is wrong with the configuration it would have come from. */
export type Configured<Value> =
  | { readonly kind: 'configured'; readonly value: Value }
  | { readonly kind: 'invalid'; readonly message: string };

/** How `cli.ts run` ends, for the launcher (see the runtime contract). */
export const exitCodes = {
  /** Stopped, e.g. by SIGTERM. */
  stopped: 0,
  /** A land asked for a restart: not a failure. */
  restart: 75,
  /** Configuration or credentials are missing or invalid: retry later, never roll back. */
  configuration: 78,
} as const;

export const variables = {
  /** The agent's repository: its code, charter and state. */
  workspace: 'AGENT_WORKSPACE',
  /** The enrollment's `KEY=value` file (a systemd credential). */
  credentialsFile: 'MUPPET_CREDENTIALS_FILE',
  /** `sops` for a self-hosted agent, whose credentials are `secrets.enc.json`. */
  credentials: 'MUPPET_CREDENTIALS',
  /** Written with the workspace's HEAD after a healthy boot. */
  lastGood: 'MUPPET_LAST_GOOD_FILE',
  /** Touched after a land, before exiting `restart`. */
  restart: 'MUPPET_RESTART_FILE',
  /** Stdio MCP servers for every wake, as `{ name: { command, args?, env? } }`. */
  mcpServers: 'MUPPET_MCP_SERVERS_JSON',
  /** Set only in a script's process: the agent's relay to Macro, its capability, and the credentials' names. */
  relayUrl: 'MUPPET_RELAY_URL',
  relayToken: 'MUPPET_RELAY_TOKEN',
  credentialNames: 'MUPPET_CREDENTIAL_NAMES',
} as const;

export type CredentialSource =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'sops' }
  | {
      readonly kind: 'relayed';
      readonly url: string;
      readonly token: string;
      readonly names: readonly string[];
      /** How Claude Code reaches Anthropic from here: through the parent's relay, in Macro-credits mode. */
      readonly claude: Readonly<Record<string, string>>;
    };

export type McpServer = {
  readonly type: 'stdio';
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
};

export type Startup = {
  readonly workspace: string;
  readonly credentials: CredentialSource;
  readonly mcpServers: Readonly<Record<string, McpServer>>;
  /**
   * What every child (a script's process, Claude Code) is started under: on
   * a computer, bubblewrap with the systemd credentials directory hidden, so
   * only this process can read the enrollment's secrets; nothing elsewhere.
   */
  readonly sandbox: readonly string[];
};

/** Set by systemd when the unit loads credentials (`LoadCredential=`). */
const credentialsDirectory = 'CREDENTIALS_DIRECTORY';

/** Bubblewrap's argv prefix that hides `directory` and changes nothing else. */
export const hiding = (directory: string): readonly string[] => [
  'bwrap',
  '--dev-bind',
  '/',
  '/',
  '--tmpfs',
  directory,
  '--',
];

const sandboxOf = (directory: string | undefined): readonly string[] =>
  directory === undefined ? [] : hiding(directory);

export type RunFiles = { readonly lastGood: string; readonly restart: string };

const McpServers = z.record(
  z.string().min(1),
  z.object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
);

const sops = 'sops';
const nameSeparator = ',';

const invalid = (message: string): { kind: 'invalid'; message: string } => ({
  kind: 'invalid',
  message,
});

const notSet = (name: string) => invalid(`${name} is not set`);

const given = (environment: Environment, name: string): string | undefined => {
  const value = environment[name];
  return value === undefined || value === '' ? undefined : value;
};

const credentialSource = (
  environment: Environment
): Configured<CredentialSource> => {
  const url = given(environment, variables.relayUrl);
  if (url !== undefined) {
    const token = given(environment, variables.relayToken);
    if (token === undefined) return notSet(variables.relayToken);
    const names = (given(environment, variables.credentialNames) ?? '')
      .split(nameSeparator)
      .filter((name) => name !== '');
    return {
      kind: 'configured',
      value: {
        kind: 'relayed',
        url,
        token,
        names,
        claude: Object.fromEntries(
          claudeKeys.flatMap((name) => {
            const value = given(environment, name);
            return value === undefined ? [] : [[name, value]];
          })
        ),
      },
    };
  }
  const chosen = given(environment, variables.credentials);
  if (chosen === sops) return { kind: 'configured', value: { kind: 'sops' } };
  if (chosen !== undefined)
    return invalid(
      `${variables.credentials} is "${chosen}": the only choice is "${sops}"; unset, ${variables.credentialsFile} is read`
    );
  const file = given(environment, variables.credentialsFile);
  if (file === undefined) return notSet(variables.credentialsFile);
  return { kind: 'configured', value: { kind: 'file', file } };
};

const mcpServers = (
  text: string | undefined,
  reserved: readonly string[]
): Configured<Readonly<Record<string, McpServer>>> => {
  if (text === undefined) return { kind: 'configured', value: {} };
  const json = (() => {
    try {
      return { parsed: true, value: JSON.parse(text) };
    } catch {
      return { parsed: false, value: undefined };
    }
  })();
  if (!json.parsed) return invalid(`${variables.mcpServers} is not JSON`);
  const servers = McpServers.safeParse(json.value);
  if (!servers.success)
    return invalid(
      `${variables.mcpServers} is not { name: { command, args?, env? } }: ${servers.error.message}`
    );
  const shadowing = Object.keys(servers.data).filter((name) =>
    reserved.includes(name)
  );
  if (shadowing.length > 0)
    return invalid(
      `${variables.mcpServers} names ${shadowing.join(', ')}, which is the agent's own server`
    );
  return {
    kind: 'configured',
    value: Object.fromEntries(
      Object.entries(servers.data).map(([name, server]) => [
        name,
        { type: 'stdio', ...server },
      ])
    ),
  };
};

/**
 * The agent's startup configuration from its environment. `reserved` are the
 * MCP server names the agent serves itself, which a given server can't take.
 */
export const startup = (
  environment: Environment,
  reserved: readonly string[]
): Configured<Startup> => {
  const workspace = given(environment, variables.workspace);
  if (workspace === undefined) return notSet(variables.workspace);
  const credentials = credentialSource(environment);
  if (credentials.kind === 'invalid') return credentials;
  const servers = mcpServers(
    given(environment, variables.mcpServers),
    reserved
  );
  if (servers.kind === 'invalid') return servers;
  return {
    kind: 'configured',
    value: {
      workspace,
      credentials: credentials.value,
      mcpServers: servers.value,
      sandbox: sandboxOf(given(environment, credentialsDirectory)),
    },
  };
};

/** The files the running agent tells its launcher through: only `cli.ts run` needs them. */
export const runFiles = (environment: Environment): Configured<RunFiles> => {
  const lastGood = given(environment, variables.lastGood);
  if (lastGood === undefined) return notSet(variables.lastGood);
  const restart = given(environment, variables.restart);
  if (restart === undefined) return notSet(variables.restart);
  return { kind: 'configured', value: { lastGood, restart } };
};
