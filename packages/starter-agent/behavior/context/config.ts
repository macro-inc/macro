import { type Caps, capsOf } from '../agent/budget.ts';
import type { Settings } from './settings.ts';

/**
 * The agent's settings that aren't secret. Everything that names a place, a person
 * or a limit is here, or in the `config.ts` of the area that owns it, so no
 * other code holds a path or an id of its own.
 */
export type Config = {
  /** This repository: the agent's behavior, charter and state. */
  readonly root: string;
  /** The charter, appended to every run's system prompt. */
  readonly charter: string;
  /** Where agent-written scripts are written for as long as it takes to import them. */
  readonly scripts: string;
  /** The command line (`bin/agent`'s program), which runs each script in a process of its own. */
  readonly cli: string;
  /** How long a script may run before its process is stopped. */
  readonly scriptTimeoutMs: number;
  /** The tsconfig scripts are type-checked with, and the file that exports the `Script` type they are held to. */
  readonly tsconfig: string;
  readonly scriptType: string;
  /** The encrypted credentials file of a self-hosted agent, and the program that reads it. */
  readonly secrets: string;
  readonly sops: string;
  /** The agent's own settings file, `agent.json`. */
  readonly settings: string;
  /** The home directory of the user the agent runs as. */
  readonly home: string;
  /** The model every run of the agent is pinned to. */
  readonly model: string;
  /** What one run, and one day of the owner's, may spend. */
  readonly budget: Caps;
  /** Areas behind a flag, from agent.json. */
  readonly features: { readonly calls: boolean };
  /** Who the agent is in Macro, and who its owner is. Only the owner's id gives orders. */
  readonly me: string;
  readonly owner: string;
  /** The agent's git identity, which lives only in the environment of its processes. */
  readonly identity: { readonly name: string; readonly email: string };
  /** The zone a wall-clock time means: the owner's day, not the machine's. */
  readonly timeZone: string;
  /** Retention: days a per-run log is kept, and lines kept in a JSONL log or a channel's history. */
  readonly keep: {
    readonly logDays: number;
    readonly logLines: number;
    readonly historyLines: number;
  };
};

const charterFile = 'AGENT.md';
const scriptsDirectory = '.scripts';
const cliFile = 'cli.ts';
const minute = 60_000;
const tsconfigFile = 'tsconfig.json';
const behaviorDirectory = 'behavior';
const behaviorFile = 'index.ts';
const secretsFile = 'secrets.enc.json';
/** The agent's settings file, beside its code. */
export const settingsFile = 'agent.json';

export const config = ({
  root,
  home,
  join,
  settings,
}: {
  readonly root: string;
  readonly home: string;
  readonly join: (...parts: readonly string[]) => string;
  readonly settings: Settings;
}): Config => ({
  root,
  charter: join(root, charterFile),
  scripts: join(root, scriptsDirectory),
  cli: join(root, cliFile),
  scriptTimeoutMs: 10 * minute,
  tsconfig: join(root, tsconfigFile),
  scriptType: join(root, behaviorDirectory, behaviorFile),
  secrets: join(root, secretsFile),
  sops: 'sops',
  settings: join(root, settingsFile),
  home,
  model: settings.model,
  budget: capsOf(settings),
  features: { calls: settings.calls ?? false },
  me: settings.me,
  owner: settings.owner,
  identity: { name: settings.name, email: settings.email },
  timeZone: settings.timeZone,
  keep: { logDays: 30, logLines: 5000, historyLines: 1000 },
});
