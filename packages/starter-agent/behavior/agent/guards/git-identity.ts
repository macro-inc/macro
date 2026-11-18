/**
 * The agent's identity comes from the environment its runs are started with
 * (`base.environment()`, behavior/context/identity.ts) and nowhere else. Git
 * config is shared by every session on a repository, and by every worktree
 * of it, so an identity written there would stamp the agent's name on the
 * machine user's commits, or the user's on the agent's. This guard denies
 * the agent's sessions anything that writes identity or credentials
 * somewhere shared, and `gh auth`, which changes the machine's login. The
 * user's own sessions aren't the agent's and pass. Only real commands count;
 * text in a quoted argument doesn't. bin/guard-hook is the entry point
 * outside the SDK: it decides what happens if this breaks.
 */
import {
  bashCommand,
  editedFile,
  type Guard,
  type ToolCall,
} from '../guard.ts';
import { identitySource, sharedGitConfigFile } from './config.ts';
import { editsInPlace, gitParts, isAgentSession } from './session.ts';
import { type Command, commands, expand, program } from './shell.ts';

export const configReason = `The agent's identity comes only from the environment its runs are started with (${identitySource}), never from git config, which every session on that repository shares. Leave it alone; if git doesn't show the agent's name, this run was started without its environment, and that is what to fix.`;
export const ghAuthReason = `The agent's GitHub login is the GH_TOKEN in its environment. \`gh auth\` changes the machine's login, which belongs to its user, or writes credentials into shared git config. ${configReason}`;

const identityKey = /^(?:user|author|committer)(?:\.(?:name|email))?$/i;
const credentialKey = /^credential(?:\.|$)/i;
const configVerbs: ReadonlySet<string> = new Set([
  'set',
  'unset',
  'get',
  'list',
  'edit',
  'rename-section',
  'remove-section',
]);
const configValueFlags: ReadonlySet<string> = new Set([
  '-f',
  '--file',
  '--blob',
  '--type',
  '--default',
  '--comment',
  '--value',
]);
const configWriteFlags: ReadonlySet<string> = new Set([
  '--add',
  '--unset',
  '--unset-all',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '-e',
  '--edit',
]);
const configReadFlags: ReadonlySet<string> = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--list',
  '-l',
]);
const ghAuthWrites: ReadonlySet<string> = new Set([
  'login',
  'logout',
  'refresh',
  'setup-git',
  'switch',
]);
/** The key a `git config` writes; no key is `git config --edit`, which can write any. */
type ConfigWrite = { readonly key?: string };

/** The flags and the other words, apart, with the value of each flag named left out of both. */
const apart = (
  args: readonly string[],
  valueFlags: ReadonlySet<string>
): { readonly flags: readonly string[]; readonly words: readonly string[] } => {
  const flags: string[] = [];
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (!word.startsWith('-')) words.push(word);
    else {
      flags.push(word);
      if (valueFlags.has(word)) index += 1;
    }
  }
  return { flags, words };
};

/** What a `git config ...` writes, or undefined when it only reads. */
export const configWrite = (
  args: readonly string[]
): ConfigWrite | undefined => {
  const { flags, words } = apart(args, configValueFlags);
  const verb = configVerbs.has(words[0] ?? '') ? words[0] : undefined;
  const rest = verb === undefined ? words : words.slice(1);
  if (
    verb === 'get' ||
    verb === 'list' ||
    flags.some((flag) => configReadFlags.has(flag))
  )
    return undefined;
  if (
    verb === undefined &&
    !flags.some((flag) => configWriteFlags.has(flag)) &&
    rest.length < 2
  )
    return undefined;
  return { key: rest[0] };
};

const sensitive = ({ key }: ConfigWrite): boolean =>
  !key || identityKey.test(key) || credentialKey.test(key);

const writesFile = (
  command: Command,
  environment: ToolCall['environment']
): boolean => {
  const name = program(command);
  const targets =
    name === 'cp' || name === 'mv'
      ? command.argv.slice(-1)
      : name === 'tee' || editsInPlace(command)
        ? command.argv.slice(1)
        : [];
  return [...command.redirects, ...targets].some((path) =>
    sharedGitConfigFile.test(expand(path, environment))
  );
};

const denied = (command: Command, call: ToolCall): string | undefined => {
  const name = program(command);
  if (name === 'git') {
    const { args } = gitParts(command, call);
    const write = args[0] === 'config' ? configWrite(args.slice(1)) : undefined;
    if (write && sensitive(write)) return configReason;
  }
  if (
    name === 'gh' &&
    command.argv[1] === 'auth' &&
    ghAuthWrites.has(command.argv[2] ?? '')
  )
    return ghAuthReason;
  return writesFile(command, call.environment) ? configReason : undefined;
};

/** Why this tool call is denied, or undefined. */
export const gitIdentity = (call: ToolCall): string | undefined => {
  if (!isAgentSession(call.environment)) return undefined;
  const file = editedFile(call);
  if (file !== undefined)
    return sharedGitConfigFile.test(file) ? configReason : undefined;
  return commands(bashCommand(call) ?? '')
    .map((command) => denied(command, call))
    .find((reason) => reason !== undefined);
};

export const gitIdentityGuard: Guard = {
  name: 'git-identity',
  check: gitIdentity,
};
